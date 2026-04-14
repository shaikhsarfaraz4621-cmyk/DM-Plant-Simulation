import pandas as pd
import json

path = r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo\DM-Plant-Simulation\dm_plant_config.xlsx"

try:
    xls = pd.ExcelFile(path)
    data = {}
    for sheet_name in xls.sheet_names:
        df = pd.read_excel(path, sheet_name=sheet_name)
        data[sheet_name] = df.to_dict(orient='records')
    
    # Just print the first few records of each to see the structure and values
    for sheet, records in data.items():
        print(f"--- {sheet} ---")
        print(json.dumps(records[:5], indent=2))
except Exception as e:
    print(f"Error: {e}")
