import pandas as pd
from dm_simulation_engine import run_dm_simulation
import os

# Use the current stress config
current_dir = os.path.dirname(__file__)
config_path = os.path.join(current_dir, "dm_stress_config.xlsx")
df_globals = pd.read_excel(config_path, sheet_name="Global_Parameters")
df_tanks = pd.read_excel(config_path, sheet_name="Tanks")
df_machines = pd.read_excel(config_path, sheet_name="Machines")

# Print W2_Cation settings
w2_conf = df_machines[df_machines['Machine_ID'] == 'W2_Cation'].iloc[0]
print(f"--- W2_Cation Debug ---")
print(f"Capacity: {w2_conf['Max_Resin_Capacity_eq']}")
print(f"Trigger: {w2_conf['Regen_Trigger_Percentage_pct']}%")
print(f"Load Factor: {w2_conf['Hardness_Load_Factor_eq_per_m3']}")

print("\nRunning simulation (50 batches, time=50000)...")
res = run_dm_simulation(df_globals, df_tanks, df_machines, sim_time=50000)

print(f"\nFinal Cation Load: {res['Resin_Log']['W2_Cation'].max()}")
c_regen = res['Event_Log'][res['Event_Log']['Event'].str.contains("Regeneration Started \(W2_Cation\)", na=False)]
print(f"W2_Cation Regens: {len(c_regen)}")
if not c_regen.empty:
    print(c_regen)
else:
    print("NO REGEN EVENTS FOUND IN LOG!")
