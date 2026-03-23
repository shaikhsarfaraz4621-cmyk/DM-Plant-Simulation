import pandas as pd
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from dm_simulation_engine import run_dm_simulation

current_dir = os.path.dirname(os.path.abspath(__file__))
config_path = os.path.join(current_dir, "dm_stress_config.xlsx")

df_globals = pd.read_excel(config_path, sheet_name="Global_Parameters")
df_tanks = pd.read_excel(config_path, sheet_name="Tanks")
df_machines = pd.read_excel(config_path, sheet_name="Machines")

print("=" * 60)
print("GLOBAL PARAMS:")
print(df_globals.to_string(index=False))

print("\n" + "=" * 60)
print("MACHINE PARAMS (Relevant Columns):")
cols = ['Machine_ID', 'Max_Resin_Capacity_eq', 'Regen_Trigger_Percentage_pct', 'Hardness_Load_Factor_eq_per_m3', 'Flow_Rate_m3_min']
print(df_machines[cols].to_string(index=False))

# Calculate: how much load does batch add per m3?
gp = dict(zip(df_globals['Parameter'], df_globals['Value']))
influent = gp['Influent_Hardness_eq_m3']
avg_batch = (gp['Batch_Size_Min_m3'] + gp['Batch_Size_Max_m3']) / 2

print("\n" + "=" * 60)
print("LOAD CALCULATION PER BATCH (avg batch size: {:.1f} m3):".format(avg_batch))
for _, row in df_machines.iterrows():
    mid = row['Machine_ID']
    cap = row['Max_Resin_Capacity_eq']
    factor = row['Hardness_Load_Factor_eq_per_m3']
    trigger_pct = row['Regen_Trigger_Percentage_pct']
    if cap > 0 and factor > 0:
        load_per_batch = avg_batch * influent * (factor / 10.0)
        trigger_eq = (trigger_pct / 100.0) * cap
        batches_to_regen = trigger_eq / load_per_batch
        print(f"  {mid}: load/batch={load_per_batch:.2f} eq, trigger_threshold={trigger_eq:.1f} eq, batches_to_regen={batches_to_regen:.1f}")
    else:
        print(f"  {mid}: No resin tracking (cap={cap}, factor={factor})")

print("\n" + "=" * 60)
print("Running simulation...")
res = run_dm_simulation(df_globals, df_tanks, df_machines, sim_time=50000)

print(f"Batches processed: {res['Batches_Processed']}")
print("\nREGENERATION EVENTS:")
ev = res['Event_Log']
regen_ev = ev[ev['Event'].str.contains("Regeneration Started", na=False)]
print(regen_ev[['Time', 'Machine', 'Event', 'Details']].to_string() if not regen_ev.empty else "NONE FOUND!")

print("\nPEAK RESIN LOADS:")
rl = res['Resin_Log']
for col in [c for c in rl.columns if c != 'Time']:
    print(f"  {col}: max={rl[col].max():.2f}")
