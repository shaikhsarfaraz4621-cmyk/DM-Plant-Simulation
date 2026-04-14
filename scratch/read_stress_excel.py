import pandas as pd
import json

path = r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo\DM-Plant-Simulation\dm_stress_config.xlsx"

try:
    xls = pd.ExcelFile(path)
    data = {}
    for sheet_name in xls.sheet_names:
        df = pd.read_excel(path, sheet_name=sheet_name)
        data[sheet_name] = df.to_dict(orient='records')
    
    print("--- Global Params ---")
    print(json.dumps(data.get("Global_Parameters", [])[:5], indent=2))
    
    print("\n--- Machines snippet ---")
    print(json.dumps(data.get("Machines", [])[:3], indent=2))
    
except Exception as e:
    print(f"Error: {e}")
