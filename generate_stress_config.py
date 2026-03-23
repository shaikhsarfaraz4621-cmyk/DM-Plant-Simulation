import pandas as pd
import os

def create_stress_config(output_path):
    # Sheet 1: Global_Parameters - HIGH ARRIVAL RATE
    global_params = pd.DataFrame([
        {"Parameter": "Interarrival_Mean_min", "Value": 2.5}, # Fast water arrival
        {"Parameter": "Batch_Size_Min_m3", "Value": 10},
        {"Parameter": "Batch_Size_Max_m3", "Value": 25},
        {"Parameter": "Influent_Hardness_eq_m3", "Value": 25}, # Dirty water
        {"Parameter": "Quality_Violation_Threshold_eq_m3", "Value": 0.05}, # Strict quality
        {"Parameter": "Max_Simulation_Batches", "Value": 100}
    ])

    # Sheet 2: Tanks - SMALL BUFFERS
    tanks = pd.DataFrame([
        {"Tank_ID": "W1_RawWater", "Capacity_m3": 100}, # Easy overflow
        {"Tank_ID": "W2_W3_Buffer", "Capacity_m3": 40},
        {"Tank_ID": "W3_W4_Buffer", "Capacity_m3": 40},
        {"Tank_ID": "W4_W5_Buffer", "Capacity_m3": 40},
        {"Tank_ID": "W5_Output_Tank", "Capacity_m3": 10000}
    ])

    # Sheet 3: Machines - UNRELIABLE & SLOW
    machines = pd.DataFrame([
        {
            "Machine_ID": "W2_Cation", "Type": "Flow", "Flow_Rate_m3_min": 0.8, # Bottleneck
            "Fixed_Time_Min_min": 0, "Fixed_Time_Max_min": 0,
            "Hardness_Load_Factor_eq_per_m3": 5, "Max_Resin_Capacity_eq": 2000, # Fast exhaustion
            "Regen_Trigger_Percentage_pct": 98, 
            "Regen_Time_Min_min": 180, "Regen_Time_Max_min": 400, # Long regen
            "Weibull_Alpha": 1.1, "Weibull_Beta": 250, # Frequent failure
            "Lognormal_Mu_min": 120, "Lognormal_Sigma_min": 30
        },
        {
            "Machine_ID": "W3_Degasser", "Type": "Fixed", "Flow_Rate_m3_min": 0,
            "Fixed_Time_Min_min": 10, "Fixed_Time_Max_min": 20, # Slow processing
            "Hardness_Load_Factor_eq_per_m3": 0, "Max_Resin_Capacity_eq": 0,
            "Regen_Trigger_Percentage_pct": 0, 
            "Regen_Time_Min_min": 0, "Regen_Time_Max_min": 0,
            "Weibull_Alpha": 1.1, "Weibull_Beta": 500,
            "Lognormal_Mu_min": 60, "Lognormal_Sigma_min": 15
        },
        {
            "Machine_ID": "W4_Anion", "Type": "Flow", "Flow_Rate_m3_min": 0.9,
            "Fixed_Time_Min_min": 0, "Fixed_Time_Max_min": 0,
            "Hardness_Load_Factor_eq_per_m3": 5, "Max_Resin_Capacity_eq": 2000,
            "Regen_Trigger_Percentage_pct": 98, 
            "Regen_Time_Min_min": 180, "Regen_Time_Max_min": 400,
            "Weibull_Alpha": 1.1, "Weibull_Beta": 250,
            "Lognormal_Mu_min": 120, "Lognormal_Sigma_min": 30
        },
        {
            "Machine_ID": "W5_MixedBed", "Type": "Flow", "Flow_Rate_m3_min": 0.7, # Final bottleneck
            "Fixed_Time_Min_min": 0, "Fixed_Time_Max_min": 0,
            "Hardness_Load_Factor_eq_per_m3": 5, "Max_Resin_Capacity_eq": 1500,
            "Regen_Trigger_Percentage_pct": 99, 
            "Regen_Time_Min_min": 240, "Regen_Time_Max_min": 500,
            "Weibull_Alpha": 1.1, "Weibull_Beta": 200,
            "Lognormal_Mu_min": 180, "Lognormal_Sigma_min": 45
        }
    ])

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        global_params.to_excel(writer, sheet_name='Global_Parameters', index=False)
        tanks.to_excel(writer, sheet_name='Tanks', index=False)
        machines.to_excel(writer, sheet_name='Machines', index=False)
        
    print(f"STRESS TEST Template successfully saved to: {output_path}")

if __name__ == "__main__":
    out_file = os.path.join(r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo", "dm_stress_config.xlsx")
    create_stress_config(out_file)
