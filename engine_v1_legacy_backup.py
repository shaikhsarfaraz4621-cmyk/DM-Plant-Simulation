import simpy
import random
import math
import pandas as pd

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
        config = self.machine_configs[m_id]
        max_cap = config.get('Max_Resin_Capacity_eq', 0)

        with self.machines[m_id].request(priority=1) as req:
            yield req
            
            if max_cap > 0:
                regen_threshold = (config['Regen_Trigger_Percentage_pct'] / 100.0) * max_cap
                influent_hardness = self.global_params['Influent_Hardness_eq_m3']
                predicted_add = batch_size * influent_hardness * (config['Hardness_Load_Factor_eq_per_m3'] / 10.0)
                
                if self.resin_loads[m_id] >= regen_threshold or self.resin_loads[m_id] + predicted_add > max_cap:
                    self.log_machine_state(m_id, "Setup")
                    curr_val = self.resin_loads[m_id]
                    self.log_event(m_id, batch_id, "Regeneration Started", f"Load at {curr_val:.1f}")
                    regen_time = random.uniform(config['Regen_Time_Min_min'], config['Regen_Time_Max_min'])
                    yield self.env.timeout(regen_time)
                    self.resin_loads[m_id] = 0.0
                    self.log_resin_loads()
                    self.log_event(m_id, "System", "Regeneration Finished", f"Unit cleaned for {batch_id}")

            self.log_machine_state(m_id, "Processing")
            self.log_event(m_id, batch_id, "Processing Started", f"Volume: {batch_size:.1f} m3")
            
            if config['Type'] == 'Flow':
                proc_time = batch_size / config['Flow_Rate_m3_min']
            else:
                proc_time = random.uniform(config['Fixed_Time_Min_min'], config['Fixed_Time_Max_min'])
                
            time_to_fail = self.check_failure(config)
            if time_to_fail < proc_time:
                yield self.env.timeout(time_to_fail)
                self.log_machine_state(m_id, "Failure")
                self.log_event(m_id, batch_id, "Machine Broke Down", "Interrupting batch")
                mu, sigma = get_lognormal_params(config['Lognormal_Mu_min'], config['Lognormal_Sigma_min'])
                repair_time = random.lognormvariate(mu, sigma)
                yield self.env.timeout(repair_time)
                self.log_event(m_id, batch_id, "Repair Finished", "Resuming batch")
                self.log_machine_state(m_id, "Processing")
                yield self.env.timeout(proc_time - time_to_fail)
            else:
                yield self.env.timeout(proc_time)
                
            if max_cap > 0:
                influent_hardness = self.global_params['Influent_Hardness_eq_m3']
                added_load = batch_size * influent_hardness * (config['Hardness_Load_Factor_eq_per_m3'] / 10.0)
                self.resin_loads[m_id] += added_load
                self.log_resin_loads()
                
            self.log_machine_state(m_id, "Idle")
            self.log_event(m_id, batch_id, "Processing Finished", "Sent downstream.")

    def process_batch(self, batch_id, batch_size):
        sequence = [
            ("W1_RawWater", "W2_Cation", "W2_W3_Buffer"),
            ("W2_W3_Buffer", "W3_Degasser", "W3_W4_Buffer"),
            ("W3_W4_Buffer", "W4_Anion", "W4_W5_Buffer"),
            ("W4_W5_Buffer", "W5_MixedBed", "W5_Output_Tank")
        ]
        
        for in_tank_id, m_id, out_tank_id in sequence:
            if self.system_failed: break
            yield self.tanks[in_tank_id].get(batch_size)
            self.log_tank_levels()
            yield self.env.process(self.process_machine(m_id, batch_size, batch_id))
            yield self.tanks[out_tank_id].put(batch_size) 
            self.log_tank_levels()
            
            if m_id == "W5_MixedBed":
                limit = self.global_params['Quality_Violation_Threshold_eq_m3']
                load_pct = self.resin_loads[m_id] / self.machine_configs[m_id]['Max_Resin_Capacity_eq']
                if (load_pct * 0.15) > limit:
                    self.quality_violations += 1
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
    return sim.run(until=sim_time)
