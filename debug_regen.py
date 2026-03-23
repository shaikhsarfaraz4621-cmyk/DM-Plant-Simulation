import pandas as pd
from dm_simulation_engine import run_dm_simulation
import os

config_path = r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo\dm_plant_config.xlsx"
df_globals = pd.read_excel(config_path, sheet_name="Global_Parameters")
df_tanks = pd.read_excel(config_path, sheet_name="Tanks")
df_machines = pd.read_excel(config_path, sheet_name="Machines")

# Force small capacity to see if regen triggers
df_machines.loc[df_machines['Machine_ID'] == 'W2_Cation', 'Max_Resin_Capacity_eq'] = 500

print("Running simulation...")
res = run_dm_simulation(df_globals, df_tanks, df_machines, sim_time=1000)

print(f"Batches: {res['Batches_Processed']}")
print(f"Resin Log for W2_Cation (first 10 rows):")
print(res['Resin_Log'][['Time', 'W2_Cation']].head(10))

# Check for any regen events in event log
regen_events = res['Event_Log'][res['Event_Log']['Event'].str.contains("Regeneration", na=False)]
print(f"\nRegenerations found: {len(regen_events)}")
print(regen_events)
