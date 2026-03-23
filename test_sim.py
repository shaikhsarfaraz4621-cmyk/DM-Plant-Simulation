import pandas as pd
from dm_simulation_engine import run_dm_simulation

config_path = r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo\dm_plant_config.xlsx"
df_globals = pd.read_excel(config_path, sheet_name="Global_Parameters")
df_tanks = pd.read_excel(config_path, sheet_name="Tanks")
df_machines = pd.read_excel(config_path, sheet_name="Machines")

res = run_dm_simulation(df_globals, df_tanks, df_machines, sim_time=100)
res['Event_Log'].to_csv('test_out.csv', index=False)
