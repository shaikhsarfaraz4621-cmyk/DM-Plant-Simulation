import pandas as pd
import os

def create_dm_template(output_path):
    # Sheet 1: Global_Parameters
    global_params = pd.DataFrame([
        {"Parameter": "Interarrival_Mean_min", "Value": 10},
        {"Parameter": "Batch_Size_Min_m3", "Value": 5},
        {"Parameter": "Batch_Size_Max_m3", "Value": 20},
        {"Parameter": "Influent_Hardness_eq_m3", "Value": 10},
        {"Parameter": "Quality_Violation_Threshold_eq_m3", "Value": 0.1},
        {"Parameter": "Max_Simulation_Batches", "Value": 50} # Target to stop the simulation
    ])

    # Sheet 2: Tanks
    tanks = pd.DataFrame([
        {"Tank_ID": "W1_RawWater", "Capacity_m3": 500},
        {"Tank_ID": "W2_W3_Buffer", "Capacity_m3": 100},
        {"Tank_ID": "W3_W4_Buffer", "Capacity_m3": 100},
        {"Tank_ID": "W4_W5_Buffer", "Capacity_m3": 100},
        {"Tank_ID": "W5_Output_Tank", "Capacity_m3": 5000}
    ])

    # Sheet 3: Machines
    machines = pd.DataFrame([
        {
            "Machine_ID": "W2_Cation", "Type": "Flow", "Flow_Rate_m3_min": 1.5,
            "Fixed_Time_Min_min": 0, "Fixed_Time_Max_min": 0,
            "Hardness_Load_Factor_eq_per_m3": 5, "Max_Resin_Capacity_eq": 50000,
            "Regen_Trigger_Percentage_pct": 90, 
            "Regen_Time_Min_min": 90, "Regen_Time_Max_min": 240,
            "Weibull_Alpha": 1.5, "Weibull_Beta": 2000, 
            "Lognormal_Mu_min": 60, "Lognormal_Sigma_min": 15
        },
        {
            "Machine_ID": "W3_Degasser", "Type": "Fixed", "Flow_Rate_m3_min": 0,
            "Fixed_Time_Min_min": 2, "Fixed_Time_Max_min": 5,
            "Hardness_Load_Factor_eq_per_m3": 0, "Max_Resin_Capacity_eq": 0,
            "Regen_Trigger_Percentage_pct": 0, 
            "Regen_Time_Min_min": 0, "Regen_Time_Max_min": 0,
            "Weibull_Alpha": 1.5, "Weibull_Beta": 2000, 
            "Lognormal_Mu_min": 60, "Lognormal_Sigma_min": 15
        },
        {
            "Machine_ID": "W4_Anion", "Type": "Flow", "Flow_Rate_m3_min": 1.5,
            "Fixed_Time_Min_min": 0, "Fixed_Time_Max_min": 0,
            "Hardness_Load_Factor_eq_per_m3": 5, "Max_Resin_Capacity_eq": 50000,
            "Regen_Trigger_Percentage_pct": 90, 
            "Regen_Time_Min_min": 120, "Regen_Time_Max_min": 150,
            "Weibull_Alpha": 1.5, "Weibull_Beta": 2000, 
            "Lognormal_Mu_min": 60, "Lognormal_Sigma_min": 15
        },
        {
            "Machine_ID": "W5_MixedBed", "Type": "Flow", "Flow_Rate_m3_min": 1.2,
            "Fixed_Time_Min_min": 0, "Fixed_Time_Max_min": 0,
            "Hardness_Load_Factor_eq_per_m3": 5, "Max_Resin_Capacity_eq": 50000,
            "Regen_Trigger_Percentage_pct": 90, 
            "Regen_Time_Min_min": 180, "Regen_Time_Max_min": 240,
            "Weibull_Alpha": 1.5, "Weibull_Beta": 2000, 
            "Lognormal_Mu_min": 60, "Lognormal_Sigma_min": 15
        }
    ])

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        global_params.to_excel(writer, sheet_name='Global_Parameters', index=False)
        tanks.to_excel(writer, sheet_name='Tanks', index=False)
        machines.to_excel(writer, sheet_name='Machines', index=False)
        
    print(f"DM Template successfully saved to: {output_path}")

if __name__ == "__main__":
    out_file = os.path.join(r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo", "dm_plant_config.xlsx")
    create_dm_template(out_file)
