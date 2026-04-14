import simpy
import random
import math
import pandas as pd
import uuid
from concurrent.futures import ProcessPoolExecutor

def get_lognormal_params(mean, std):
    variance = std ** 2
    mean_sq = mean ** 2
    sigma = math.sqrt(math.log(1 + variance / mean_sq))
    mu = math.log(mean) - (sigma ** 2) / 2
    return mu, sigma

class DMPlantSimulation:
    def __init__(self, config):
        self.env = simpy.Environment()
        self.config = config
        self.global_params = config['global_params']
        
        self.tanks = {}
        self.node_configs = {n['name']: n for n in config['nodes']}
        
        # 1. Identify all nodes mentioned in the graph (Buffers sheet)
        all_node_names = set()
        for b in config['buffers']:
            all_node_names.add(b['from'])
            all_node_names.add(b['to'])
        # Also include explicit nodes
        for n in config['nodes']:
            all_node_names.add(n['name'])

        self.machines = {}
        self.resin_loads = {}
        self.machine_util = {}
        self.tanks = {}

        for name in all_node_names:
            config_node = self.node_configs.get(name)
            
            if config_node and config_node['type'] == 'machine':
                self.machines[name] = simpy.PriorityResource(self.env, capacity=1)
                self.resin_loads[name] = 0.0
                self.machine_util[name] = {}
            else:
                # Default capacity for buffers/implicit tanks
                cap = config_node.get('capacity', 100) if config_node else 100
                self.tanks[name] = simpy.Container(self.env, capacity=cap, init=0)

        # Build Graph for dynamic routing
        self.successors = {}
        for b in config['buffers']:
            if b['from'] not in self.successors: self.successors[b['from']] = []
            self.successors[b['from']].append(b)

        self.event_trace = []
        self.sample_queue_trace = {n: [] for n in all_node_names}
        self.machine_occupancy = {m: 0.0 for m in self.machines.keys()}
        self.quality_violations = 0
        self.system_failed = False
        self.batches_processed = 0
        self.completed_items = []
        self.all_batches_done = self.env.event()
        
        # Internal state for machines to track util
        self.machine_util = {m: {"PROCESSING":0, "SETUP":0, "DOWN":0, "IDLE":0} for m in self.machines.keys()}
        self.last_state_time = {m: 0 for m in self.machines.keys()}
        self.current_state = {m: "IDLE" for m in self.machines.keys()}

    def log_trace(self, ev_type, node, mat=None, data=None):
        self.event_trace.append({
            "t": round(self.env.now, 2),
            "type": ev_type,
            "node": node,
            "mat": mat,
            "data": data or {}
        })

    def update_util(self, m_id, new_state):
        t = self.env.now
        dur = t - self.last_state_time[m_id]
        if self.current_state[m_id] in self.machine_util[m_id]:
            self.machine_util[m_id][self.current_state[m_id]] += dur
        self.current_state[m_id] = new_state
        self.last_state_time[m_id] = t
        
        # Log to trace
        state_map = {"PROCESSING": "PROCESSING", "SETUP": "SETUP", "DOWN": "DOWN", "IDLE": "IDLE"}
        self.log_trace("STATE", m_id, data={"state": state_map.get(new_state, "IDLE")})

    def check_failure(self, config):
        # Using fixed Beta for simplicity in this port
        return random.weibullvariate(config['failure_rate'], 1.5)

    def arrival_process(self):
        mean_interarrival = self.global_params.get('Interarrival_Mean_min', 30)
        b_min = self.global_params.get('Batch_Size_Min_m3', 5)
        b_max = self.global_params.get('Batch_Size_Max_m3', 15)
        target_batches = int(self.global_params.get('Max_Simulation_Batches', 50))
        
        batch_counter = 1
        while batch_counter <= target_batches and not self.system_failed:
            time_to_next = random.expovariate(1.0 / mean_interarrival)
            yield self.env.timeout(time_to_next)
            
            batch_size = random.uniform(b_min, b_max)
            batch_id = f"BATCH_{batch_counter}"
            
            w1 = self.tanks['W1_RawWater']
            if w1.level + batch_size > w1.capacity:
                self.log_trace("MESSAGE", "SYSTEM", data={"msg": f"SYSTEM FAILURE: W1 Overflow at {self.env.now:.1f}"})
                self.system_failed = True
                if not self.all_batches_done.triggered:
                    self.all_batches_done.succeed()
                break
                
            yield w1.put(batch_size)
            self.log_trace("TRANSIT_END", "W1_RawWater", "Raw_Water", {"part_id": batch_id, "size": batch_size})
            self.env.process(self.process_batch(batch_id, batch_size))
            batch_counter += 1

    def process_machine(self, m_id, batch_size, batch_id, hardness):
        config = self.node_configs[m_id]
        max_cap = config.get('max_resin_cap', 0)

        with self.machines[m_id].request(priority=1) as req:
            yield req
            
            if max_cap > 0:
                regen_threshold = (config['regen_threshold'] / 100.0) * max_cap
                
                # Primary beds (Cation/Anion) treat different ions, so they both experience the full RAW load.
                # Only the MixedBed uses the passed-in "hardness" since it is polishing the slippage.
                effective_hardness_for_load = hardness
                if "MixedBed" not in m_id:
                    effective_hardness_for_load = float(self.global_params.get('Influent_Hardness_eq_m3', 50))
                
                predicted_add = batch_size * effective_hardness_for_load * (config['hardness_factor'] / 10.0)
                
                if self.resin_loads[m_id] >= regen_threshold or self.resin_loads[m_id] + predicted_add > max_cap:
                    self.update_util(m_id, "SETUP")
                    regen_time = random.uniform(config['regen_time_range'][0], config['regen_time_range'][1])
                    yield self.env.timeout(regen_time)
                    self.resin_loads[m_id] = 0.0
                    self.update_util(m_id, "IDLE")

            self.update_util(m_id, "PROCESSING")
            self.machine_occupancy[m_id] = batch_size
            self.log_trace("PROCESS_START", m_id, "Water", {"part_id": batch_id, "hardness": hardness})
            
            if config['machine_type'] == 'Flow':
                proc_time = batch_size / max(config['flow_rate'], 0.01)
            else:
                proc_time = random.uniform(config['fixed_time_range'][0], config['fixed_time_range'][1])
                
            time_to_fail = self.check_failure(config)
            if time_to_fail < proc_time:
                yield self.env.timeout(time_to_fail)
                self.update_util(m_id, "DOWN")
                mu, sigma = get_lognormal_params(config['repair_time'], config['repair_time'] * 0.2)
                repair_time = random.lognormvariate(mu, sigma)
                yield self.env.timeout(repair_time)
                self.update_util(m_id, "PROCESSING")
                yield self.env.timeout(proc_time - time_to_fail)
            else:
                yield self.env.timeout(proc_time)
            
            if max_cap > 0:
                effective_hardness_for_load = hardness
                if "MixedBed" not in m_id:
                    effective_hardness_for_load = float(self.global_params.get('Influent_Hardness_eq_m3', 50))
                    
                added_load = batch_size * effective_hardness_for_load * (config['hardness_factor'] / 10.0)
                self.resin_loads[m_id] += added_load
                
            self.log_trace("PROCESS_END", m_id, "Water", {"part_id": batch_id})
            self.machine_occupancy[m_id] = 0.0
            self.update_util(m_id, "IDLE")
            
            efficiency = 0.0
            if max_cap > 0:
                # Calculate how exhausted the resin is
                load_ratio = min(1.0, self.resin_loads[m_id] / max_cap)
                
                # Realistic Resin Exhaustion Curve:
                # 0-70% loaded: excellent removal (98%)
                # 70-90% loaded: slight slippage (95% -> 85%)
                # 90%+ loaded: heavy exhaustion/breakthrough (drops rapidly to 50%)
                if load_ratio < 0.70:
                    efficiency = 0.98
                elif load_ratio < 0.90:
                    efficiency = 0.98 - ((load_ratio - 0.70) * 0.65) # drops to ~0.85
                else:
                    efficiency = 0.85 - ((load_ratio - 0.90) * 3.5)  # drops to 0.50
                
                # Add minor stochastic noise for realistic fluctuation (+/- 2%)
                efficiency = max(0.1, min(0.99, efficiency * random.uniform(0.98, 1.02)))
                
            new_hardness = hardness * (1 - efficiency)
            return new_hardness

    def queue_monitor(self):
        while True:
            for name in self.sample_queue_trace.keys():
                val = 0
                if name in self.tanks:
                    val = self.tanks[name].level
                elif name in self.machine_occupancy:
                    val = self.machine_occupancy[name]
                self.sample_queue_trace[name].append({"t": self.env.now, "count": val})
            yield self.env.timeout(5) # Snapshot every 5 virtual mins

    def process_batch(self, batch_id, batch_size):
        current_hardness = float(self.global_params.get('Influent_Hardness_eq_m3', 250))
        current_node = "W1_RawWater"
        visited = set()

        while not self.system_failed:
            visited.add(current_node)
            
            # Find next connection
            options = self.successors.get(current_node, [])
            if not options: break
            
            # For this DM plant demo, we pick the first valid successor (Simple path)
            # Future: could pick based on load Balancing
            sel = options[0]
            next_node = sel['to']
            
            # 1. TRANSIT START
            self.log_trace("TRANSIT_START", current_node, "Water", {"to": next_node, "part_id": batch_id, "hardness": current_hardness})
            
            # 2. SOURCE NODE EXIT (If it's a tank/buffer, we GET from it)
            if current_node in self.tanks:
                yield self.tanks[current_node].get(batch_size)
            
            yield self.env.timeout(0.5) # Physical flow delay
            
            # 3. TRANSIT END
            self.log_trace("TRANSIT_END", next_node, "Water", {"part_id": batch_id, "hardness": current_hardness})

            # 4. NEXT NODE ARRIVAL
            if next_node in self.machines:
                current_hardness = yield self.env.process(self.process_machine(next_node, batch_size, batch_id, current_hardness))
            elif next_node in self.tanks:
                # Put into next tank
                if self.tanks[next_node].level + batch_size > self.tanks[next_node].capacity:
                     self.log_trace("MESSAGE", next_node, data={"msg": f"CRITICAL: {next_node} Overflow!"})
                     self.system_failed = True
                     break
                yield self.tanks[next_node].put(batch_size)
                
                # If this tank has no successors, it's an output point
                if not self.successors.get(next_node):
                    limit = float(self.global_params.get('Quality_Violation_Threshold_eq_m3', 3))
                    if current_hardness > limit:
                        self.quality_violations += 1
                    
                    self.batches_processed += 1
                    exit_time = self.env.now
                    start_time = visited_start_time if 'visited_start_time' in locals() else exit_time - 20
                    self.completed_items.append({
                        "id": batch_id,
                        "time_done": exit_time,
                        "cycle_time": exit_time - start_time,
                        "material": "Demineralised Water",
                        "volume": batch_size,
                        "quality_score": 100 if current_hardness <= limit else 0
                    })
                    
                    if self.batches_processed >= int(self.global_params.get('Max_Simulation_Batches', 50)):
                        if not self.all_batches_done.triggered:
                            self.all_batches_done.succeed()
                    break

            current_node = next_node
            if current_node in visited and len(options) == 1: # Cycle detection
                break

    def run(self):
        self.env.process(self.arrival_process())
        self.env.process(self.queue_monitor())
        until = self.config.get("simulation_time_mins", 1440)
        self.env.run(until=self.all_batches_done | self.env.timeout(until))
        
        # Final util update
        for m in self.machines.keys():
            self.update_util(m, "END")

        return {
            "throughput": self.batches_processed,
            "quality_violations": self.quality_violations,
            "animation_trace": self.event_trace,
            "machine_util": self.machine_util,
            "sim_time": self.env.now,
            "average_throughput": self.batches_processed,
            "average_downtime": sum(u.get("DOWN",0) for u in self.machine_util.values()) / max(len(self.machines), 1),
            "average_cycle_time": self.env.now / max(self.batches_processed, 1),
            "sample_queue_trace": self.sample_queue_trace,
            "completed_items": self.completed_items
        }

def run_iteration(config):
    sim = DMPlantSimulation(config)
    return sim.run()

def run_scenario(config):
    runs = config.get("runs", 1)
    # Using Pool for parallel runs if needed
    results = []
    for _ in range(runs):
        results.append(run_iteration(config))
    
    # Simple average for summary
    avg_tp = sum(r['throughput'] for r in results) / runs
    avg_qv = sum(r['quality_violations'] for r in results) / runs
    
    final_res = results[0]
    final_res['average_throughput'] = avg_tp
    final_res['quality_violations'] = avg_qv
    final_res['runs'] = runs
    return final_res
