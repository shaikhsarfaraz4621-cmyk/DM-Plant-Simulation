import pandas as pd
import io
import random

def parse_excel_to_config(file_bytes):
    try:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
        
        # DM Plant Sheets
        global_df = pd.DataFrame()
        tanks_df = pd.DataFrame()
        machines_df = pd.DataFrame()
        
        sheet_names_lower = {n.lower(): n for n in xls.sheet_names}
        
        if 'global_parameters' in sheet_names_lower:
            global_df = xls.parse(sheet_names_lower['global_parameters'])
        if 'tanks' in sheet_names_lower:
            tanks_df = xls.parse(sheet_names_lower['tanks'])
        if 'machines' in sheet_names_lower:
            machines_df = xls.parse(sheet_names_lower['machines'])

        if global_df.empty or tanks_df.empty or machines_df.empty:
            raise ValueError("DM Plant Excel must contain 'Global_Parameters', 'Tanks', and 'Machines' sheets.")

        global_params = dict(zip(global_df['Parameter'], global_df['Value']))
        
        config = {
            "scenario_name": "DM_Plant_Simulation",
            "simulation_time_mins": int(global_params.get('Simulation_Time_min', 1440)),
            "runs": 5,
            "global_params": {
                **global_params,
                "Interarrival_Mean_min": global_params.get('Interarrival_Mean_min', 15),
                "Max_Simulation_Batches": global_params.get('Max_Simulation_Batches', 100)
            },
            "nodes": [],
            "buffers": [],
            "material_types": ["Water"],
            "demand": [{"product": "Water", "rate_per_hr": 10}],
            "product_blueprints": [{"name": "Water", "path": []}]
        }

        # Mapping Tanks to Nodes
        for _, row in tanks_df.iterrows():
            name = str(row['Tank_ID'])
            node_type = "buffer" if "buffer" in name.lower() or "sump" in name.lower() else "tank"
            config["nodes"].append({
                "name": name,
                "type": node_type,
                "capacity": float(row['Capacity_m3']),
                "count": 1
            })

        # Mapping Machines to Nodes
        for _, row in machines_df.iterrows():
            config["nodes"].append({
                "name": row['Machine_ID'],
                "type": "machine",
                "machine_type": row['Type'],
                "count": 1,
                "flow_rate": float(row.get('Flow_Rate_m3_min', 0.2)),
                "fixed_time_range": [float(row.get('Fixed_Time_Min_min', 0)), float(row.get('Fixed_Time_Max_min', 0))],
                "max_resin_cap": float(row.get('Max_Resin_Capacity_eq', 0)),
                "regen_threshold": float(row.get('Regen_Trigger_Percentage_pct', 90)),
                "regen_time_range": [float(row.get('Regen_Time_Min_min', 60)), float(row.get('Regen_Time_Max_min', 120))],
                "hardness_factor": float(row.get('Hardness_Load_Factor_eq_per_m3', 1.0)),
                "failure_rate": float(row.get('Weibull_Beta', 2000)), # Simplified use of Weibull for now
                "repair_time": float(row.get('Lognormal_Mu_min', 60))
            })

        # Define sequence
        sequence = []
        if 'sequence' in sheet_names_lower:
            seq_df = xls.parse(sheet_names_lower['sequence'])
            for _, row in seq_df.iterrows():
                sequence.append((row['From'], row['To'], row['Material']))
        else:
            # Fallback hardcoded for DM Plant
            sequence = [
                ("W1_RawWater", "W2_Cation", "Raw_Water"),
                ("W2_Cation", "W2_W3_Buffer", "Cation_Rich"),
                ("W2_W3_Buffer", "W3_Degasser", "Buffered_Water"),
                ("W3_Degasser", "W3_W4_Buffer", "Degassed_Water"),
                ("W3_W4_Buffer", "W4_Anion", "Anion_Ready"),
                ("W4_Anion", "W4_W5_Buffer", "Anion_Processed"),
                ("W4_W5_Buffer", "W5_MixedBed", "MB_Ready"),
                ("W5_MixedBed", "W5_Output_Tank", "Demineralised_Water")
            ]

        # Ensure all nodes in sequence exist
        existing_node_names = {n['name'] for n in config["nodes"]}
        # Note: We are no longer adding implicit Buffer nodes as cards. 
        # The simulation engine will handle them as logical containers, 
        # and the frontend will show them as edge labels.
        for fr, to, _ in sequence:
            for node_name in [fr, to]:
                if node_name not in existing_node_names:
                    # In case of missing machines/tanks, we can add them as generic nodes 
                    # but for this DM plant, buffers are handled separately.
                    pass

        for fr, to, mat in sequence:
            config["buffers"].append({
                "from": fr,
                "to": to,
                "material_type": mat,
                "capacity": 99999,
                "probability": 1.0
            })

        return config
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise ValueError(f"Failed to parse DM Excel: {str(e)}")
