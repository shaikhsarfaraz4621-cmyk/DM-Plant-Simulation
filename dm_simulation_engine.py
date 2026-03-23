import simpy
import random
import math
import pandas as pd
import logging

def get_lognormal_params(mean, std):
    variance = std ** 2
    mean_sq = mean ** 2
    sigma = math.sqrt(math.log(1 + variance / mean_sq))
    mu = math.log(mean) - (sigma ** 2) / 2
    return mu, sigma

class DMPlantSimulation:
    def __init__(self, global_df, tanks_df, machines_df):
        self.env = simpy.Environment()
        self.global_params = dict(zip(global_df['Parameter'], global_df['Value']))
        self.tanks_df = tanks_df
        self.machines_df = machines_df
        
        self.tanks = {}
        for _, row in tanks_df.iterrows():
            self.tanks[row['Tank_ID']] = simpy.Container(self.env, capacity=row['Capacity_m3'], init=0)
            
        self.machines = {}
        self.machine_configs = {}
        self.resin_loads = {}
        for _, row in machines_df.iterrows():
            m_id = row['Machine_ID']
            self.machines[m_id] = simpy.PriorityResource(self.env, capacity=1)
            self.machine_configs[m_id] = row.to_dict()
            self.resin_loads[m_id] = 0.0

        self.tank_levels_log = []
        self.machine_state_log = []
        self.resin_load_log = []
        self.event_log = []
        self.quality_violations = 0
        self.system_failed = False
        
        self.batches_processed = 0

    def log_event(self, machine, batch_id, event, details=""):
        self.event_log.append({
            "Time": self.env.now,
            "Machine": machine,
            "Batch": batch_id,
            "Event": event,
            "Details": details
        })

    def log_tank_levels(self):
        levels = {"Time": self.env.now}
        for t_id, t in self.tanks.items():
            levels[t_id] = t.level
        self.tank_levels_log.append(levels)
        
    def log_resin_loads(self):
        loads = {"Time": self.env.now}
        for m_id, load in self.resin_loads.items():
            loads[m_id] = load
        self.resin_load_log.append(loads)

    def log_machine_state(self, m_id, state):
        self.machine_state_log.append({
            "Time": self.env.now,
            "Machine": m_id,
            "State": state
        })

    def check_failure(self, config):
        beta = config['Weibull_Beta']
        alpha = config['Weibull_Alpha']
        return random.weibullvariate(beta, alpha)

    def arrival_process(self):
        mean_interarrival = self.global_params['Interarrival_Mean_min']
        b_min = self.global_params['Batch_Size_Min_m3']
        b_max = self.global_params['Batch_Size_Max_m3']
        target_batches = self.global_params['Max_Simulation_Batches']
        
        batch_counter = 1
        while batch_counter <= target_batches and not self.system_failed:
            time_to_next = random.expovariate(1.0 / mean_interarrival)
            yield self.env.timeout(time_to_next)
            
            batch_size = random.uniform(b_min, b_max)
            batch_id = f"B_{batch_counter}"
            
            # Check overflow
            w1 = self.tanks['W1_RawWater']
            if w1.level + batch_size > w1.capacity:
                self.log_event("System", batch_id, "SYSTEM FAILURE (Spillage)", f"W1 Overflow: {w1.level + batch_size:.1f} > {w1.capacity}")
                self.system_failed = True
                break
                
            yield w1.put(batch_size)
            self.log_tank_levels()
            self.log_event("W1_RawWater", batch_id, "Batch Arrived", f"Size: {batch_size:.1f} m3")
            
            self.env.process(self.process_batch(batch_id, batch_size))
            batch_counter += 1

    def process_machine(self, m_id, batch_size, batch_id):
        """Standard processing unit logic for Flow and Fixed time machines, including resin and failures."""
        self.log_event("DEBUG", batch_id, "Entering process_machine", m_id)
        config = self.machine_configs[m_id]

        
        # 1. Check Regeneration Trigger before processing
        max_cap = config['Max_Resin_Capacity_eq']
        if max_cap > 0:
            regen_threshold = (config['Regen_Trigger_Percentage_pct'] / 100.0) * max_cap
            # Predict load after batch
            influent_hardness = self.global_params['Influent_Hardness_eq_m3']
            predicted_add = batch_size * influent_hardness * (config['Hardness_Load_Factor_eq_per_m3'] / 10.0)
            
            # Initial check to see if we might need to queue for regeneration
            if self.resin_loads[m_id] >= regen_threshold or self.resin_loads[m_id] + predicted_add > max_cap:
                with self.machines[m_id].request(priority=0) as req: # high priority for maintenance
                    yield req
                    # RE-CHECK: Once we have the machine, check if someone else already cleaned it!
                    current_load = self.resin_loads[m_id]
                    if current_load >= regen_threshold or current_load + predicted_add > max_cap:
                        self.log_machine_state(m_id, "Setup")
                        self.log_event(m_id, "System", f"Regeneration Started ({m_id})", f"Load at {current_load:.1f}")
                        regen_time = random.uniform(config['Regen_Time_Min_min'], config['Regen_Time_Max_min'])
                        yield self.env.timeout(regen_time)
                        self.resin_loads[m_id] = 0.0
                        self.log_resin_loads()
                        self.log_event(m_id, "System", f"Regeneration Finished ({m_id})")
                        self.log_machine_state(m_id, "Idle")
                    else:
                        pass
                    
        # 2. Regular Processing
        with self.machines[m_id].request(priority=1) as req:
            yield req
            self.log_machine_state(m_id, "Processing")
            self.log_event(m_id, batch_id, "Processing Started", f"Volume: {batch_size:.1f} m3")
            
            # Calculate processing time
            if config['Type'] == 'Flow':
                proc_time = batch_size / config['Flow_Rate_m3_min']
            else:
                proc_time = random.uniform(config['Fixed_Time_Min_min'], config['Fixed_Time_Max_min'])
                
            # Quick deterministic check for failure during processing window
            time_to_fail = self.check_failure(config)
            if time_to_fail < proc_time:
                # Failure occurs during this processing!
                yield self.env.timeout(time_to_fail)
                self.log_machine_state(m_id, "Failure")
                self.log_event(m_id, batch_id, "Machine Broke Down", "Interrupting batch")
                
                mu, sigma = get_lognormal_params(config['Lognormal_Mu_min'], config['Lognormal_Sigma_min'])
                repair_time = random.lognormvariate(mu, sigma)
                yield self.env.timeout(repair_time)
                
                self.log_event(m_id, batch_id, "Repair Finished", "Resuming batch")
                self.log_machine_state(m_id, "Processing")
                yield self.env.timeout(proc_time - time_to_fail) # finish remaining processing
            else:
                yield self.env.timeout(proc_time)
                
            # Add resin load - Use the EXACT SAME formula as predicted_add
            if max_cap > 0:
                influent_hardness = self.global_params['Influent_Hardness_eq_m3']
                added_load = batch_size * influent_hardness * (config['Hardness_Load_Factor_eq_per_m3'] / 10.0)
                self.resin_loads[m_id] += added_load
                self.log_resin_loads()
                
            self.log_machine_state(m_id, "Idle")
            self.log_event(m_id, batch_id, "Processing Finished", f"Sent to downstream buffer.")

    def process_batch(self, batch_id, batch_size):
        """Routes a single batch through the 5 units and 4 buffers sequentially."""
        sequence = [
            ("W1_RawWater", "W2_Cation", "W2_W3_Buffer"),
            ("W2_W3_Buffer", "W3_Degasser", "W3_W4_Buffer"),
            ("W3_W4_Buffer", "W4_Anion", "W4_W5_Buffer"),
            ("W4_W5_Buffer", "W5_MixedBed", "W5_Output_Tank")
        ]
        
        for input_tank_id, m_id, output_tank_id in sequence:
            if self.system_failed: break
            
            in_tank = self.tanks[input_tank_id]
            out_tank = self.tanks[output_tank_id]
            
            # 1. Pull from Input Tank (Blocking if empty)
            yield in_tank.get(batch_size)
            self.log_tank_levels()
            
            # 2. Process in Machine
            yield self.env.process(self.process_machine(m_id, batch_size, batch_id))
            
            # 3. Push to Output Tank (Blocking if full)
            if out_tank.level + batch_size > out_tank.capacity:
                self.log_event(m_id, batch_id, "Blocked by Downstream", f"Waiting for space in {output_tank_id}")
            yield out_tank.put(batch_size) 
            self.log_tank_levels()
            
            # Quality Check on Final Stage
            if m_id == "W5_MixedBed":
                # Simulated Quality check
                limit = self.global_params['Quality_Violation_Threshold_eq_m3']
                # Simplistic quality degradation simulation scaling with total load
                load_pct = self.resin_loads[m_id] / self.machine_configs[m_id]['Max_Resin_Capacity_eq']
                effluent_hardness = load_pct * 0.15 # if close to 100%, hardness hits 0.15
                if effluent_hardness > limit:
                    self.quality_violations += 1
                    self.log_event(m_id, batch_id, "Quality Violation", f"Hardness {effluent_hardness:.3f} > {limit}")
                self.batches_processed += 1

    def run(self, until=1000):
        self.env.process(self.arrival_process())
        self.log_tank_levels()
        self.log_resin_loads()
        
        for m_id in self.machines.keys():
            self.log_machine_state(m_id, "Idle")
            
        self.env.run(until=until)
        
        return {
            "Time": self.env.now,
            "Batches_Processed": self.batches_processed,
            "Quality_Violations": self.quality_violations,
            "System_Failed": self.system_failed,
            "Tank_Log": pd.DataFrame(self.tank_levels_log),
            "State_Log": pd.DataFrame(self.machine_state_log),
            "Resin_Log": pd.DataFrame(self.resin_load_log),
            "Event_Log": pd.DataFrame(self.event_log)
        }

def run_dm_simulation(global_df, tanks_df, machines_df, sim_time=10000):
    sim = DMPlantSimulation(global_df, tanks_df, machines_df)
    results = sim.run(until=sim_time)
    return results
