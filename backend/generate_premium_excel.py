import pandas as pd
import os

path = r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo\DM-Plant-Simulation\backend\dm_plant_premium.xlsx"

# 1. Global Parameters
global_params = pd.DataFrame([
    ["Simulation_Time_min", 2880], # 48 hours to see more cycles
    ["Interarrival_Mean_min", 15],
    ["Batch_Size_Min_m3", 15],
    ["Batch_Size_Max_m3", 25],
    ["Max_Simulation_Batches", 300],
    ["Influent_Hardness_eq_m3", 50],
    ["Quality_Violation_Threshold_eq_m3", 0.05] # MASSIVELY REDUCED threshold so sequential slip triggers violations!
], columns=["Parameter", "Value"])

# 2. Tanks
# Removed B Surges
tanks = pd.DataFrame([
    ["W1_RawWater", 10000, "Inlet Reservoir"],
    ["W5_Output_Tank", 10000, "Clean Water Basin"],
    ["W2_W3_Buffer_A", 800, "Cation A Surge"],
    ["Degasser_Sump", 1200, "Degasser Tower Basin"]
], columns=["Tank_ID", "Capacity_m3", "Description"])

# 3. Machines
# Removed B trains. Reduced Resin Capacity to trigger Setup more often. Reduced Weibull Beta to trigger failures.
machines = pd.DataFrame([
    ["P1_Inlet_Pump", "Flow", 6.0, 0, 0, 0, 0, 0, 0, 0, 800, 20],
    ["W2_Cation_A", "Flow", 6.0, 0, 0, 6000, 95, 140, 200, 2.8, 350, 45], # Fails every 350 mins approx
    ["W3_Degasser", "Flow", 6.0, 0, 0, 0, 0, 0, 0, 0.4, 500, 30],
    ["W4_Anion_A", "Flow", 6.0, 0, 0, 5000, 95, 160, 220, 2.2, 400, 60],
    ["W5_MixedBed", "Flow", 6.0, 0, 0, 8000, 95, 180, 240, 1.8, 500, 90]
], columns=[
    "Machine_ID", "Type", "Flow_Rate_m3_min", "Fixed_Time_Min_min", "Fixed_Time_Max_min",
    "Max_Resin_Capacity_eq", "Regen_Trigger_Percentage_pct", "Regen_Time_Min_min", "Regen_Time_Max_min",
    "Hardness_Load_Factor_eq_per_m3", "Weibull_Beta", "Lognormal_Mu_min"
])

# 4. Sequence
# Simplified sequence for a single train.
sequence = pd.DataFrame([
    ["W1_RawWater", "P1_Inlet_Pump", "Raw_Water"],
    ["P1_Inlet_Pump", "W2_Cation_A", "Raw_Pushed"],
    ["W2_Cation_A", "W2_W3_Buffer_A", "Cation_Out_A"],
    ["W2_W3_Buffer_A", "W3_Degasser", "Buffered_A"],
    ["W3_Degasser", "Degasser_Sump", "Degassed_Liquid"],
    ["Degasser_Sump", "W4_Anion_A", "Gravity_Feed_A"],
    ["W4_Anion_A", "W5_MixedBed", "Anion_Out_A"],
    ["W5_MixedBed", "W5_Output_Tank", "DM_Final"]
], columns=["From", "To", "Material"])

# Save to Excel
with pd.ExcelWriter(path) as writer:
    global_params.to_excel(writer, sheet_name="Global_Parameters", index=False)
    tanks.to_excel(writer, sheet_name="Tanks", index=False)
    machines.to_excel(writer, sheet_name="Machines", index=False)
    sequence.to_excel(writer, sheet_name="Sequence", index=False)

print(f"Premium Excel created at {path}")
