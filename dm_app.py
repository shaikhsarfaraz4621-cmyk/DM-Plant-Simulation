import streamlit as st
import pandas as pd
import plotly.express as px
import os
import json
from openai import OpenAI
from dm_simulation_engine import run_dm_simulation

st.set_page_config(page_title="DM Plant Simulation", layout="wide")

# --- DATA LOADING & SESSION STATE ---
config_path = r"c:\Users\Sarfaraz\Desktop\simulation_demo\chemical procedures demo\dm_plant_config.xlsx"

# 1. Handle File Upload or Reset
uploaded_file = st.file_uploader("📂 Upload your DM Configuration Excel File", type=["xlsx"])

if uploaded_file is not None:
    source_df = uploaded_file
    if st.session_state.get('last_uploaded') != uploaded_file.name:
        st.session_state['df_globals'] = pd.read_excel(source_df, sheet_name="Global_Parameters")
        st.session_state['df_tanks'] = pd.read_excel(source_df, sheet_name="Tanks")
        st.session_state['df_machines'] = pd.read_excel(source_df, sheet_name="Machines")
        st.session_state['last_uploaded'] = uploaded_file.name
        st.success("Custom configuration loaded!")
elif st.session_state.get('df_globals') is None:
    if os.path.exists(config_path):
        source_df = config_path
        st.session_state['df_globals'] = pd.read_excel(source_df, sheet_name="Global_Parameters")
        st.session_state['df_tanks'] = pd.read_excel(source_df, sheet_name="Tanks")
        st.session_state['df_machines'] = pd.read_excel(source_df, sheet_name="Machines")
        st.info("Using default configuration.")
    else:
        st.error("No configuration found.")
        st.stop()

# --- AI ASSISTANT CORE ---
DEEPSEEK_API_KEY = "sk-84b78e39161d49e081bb04d0fcc99fd9"
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

def get_ai_diagnostic(user_input=None, is_auto=False):
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    # 1. Prepare Context
    g_context = st.session_state['df_globals'].to_json(orient='records')
    m_context = st.session_state['df_machines'][['Machine_ID', 'Flow_Rate_m3_min', 'Max_Resin_Capacity_eq', 'Regen_Trigger_Percentage_pct']].to_json(orient='records')
    
    res_context = "No simulation run yet."
    if 'dm_results' in st.session_state:
        r = st.session_state['dm_results']
        res_context = f"Last Run: Batches={r['Batches_Processed']}, Quality Violations={r['Quality_Violations']}, Failed={r['System_Failed']}"
        if 'agg_pct' in st.session_state:
            res_context += f" | OEE Stats: {st.session_state['agg_pct'].to_json()}"

    system_prompt = f"""You are an expert DM Plant Consultant.
    CURRENT CONFIG: {g_context}
    MACHINES: {m_context}
    RESULTS: {res_context}

    Your goal is to be PROACTIVE. If you see a bottleneck or failure, suggest a fix.
    To suggest changes, use this JSON format:
    ```json
    {{
      "Update": {{
        "Global": {{"Interarrival_Mean_min": 5.0}},
        "Machines": {{"W2_Cation": {{"Flow_Rate_m3_min": 2.5}}}}
      }}
    }}
    ```"""

    # 2. Add input to history
    if is_auto:
        st.session_state.messages.append({"role": "user", "content": "🔄 [System Trigger] Simulation complete. Please analyze results and suggest optimizations."})
    elif user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})

    # 3. Call API
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "system", "content": system_prompt}, *st.session_state.messages]
        )
        ai_message = response.choices[0].message.content
        st.session_state.messages.append({"role": "assistant", "content": ai_message})
        
        # Check for JSON updates
        if "```json" in ai_message:
            js = ai_message.split("```json")[1].split("```")[0].strip()
            st.session_state['pending_update'] = json.loads(js).get("Update")
    except Exception as e:
        st.error(f"AI Assistant Error: {str(e)}")

# --- AI ASSISTANT SIDEBAR ---
with st.sidebar:
    st.title("🤖 AI Simulation Assistant")
    
    # Auto-trigger analysis if simulation just finished
    if st.session_state.get('run_auto_ai'):
        with st.spinner("AI is analyzing simulation results..."):
            get_ai_diagnostic(is_auto=True)
            st.session_state['run_auto_ai'] = False
            st.rerun()

    # Apply AI Suggested Updates
    if st.session_state.get('pending_update'):
        st.info("💡 AI has proposed optimizations!")
        if st.button("✅ Apply AI Suggested Changes", use_container_width=True):
            update = st.session_state['pending_update']
            if "Global" in update:
                for k, v in update["Global"].items():
                    st.session_state['df_globals'].loc[st.session_state['df_globals']['Parameter'] == k, 'Value'] = v
            if "Machines" in update:
                for mid, params in update["Machines"].items():
                    for k, v in params.items():
                        st.session_state['df_machines'].loc[st.session_state['df_machines']['Machine_ID'] == mid, k] = v
            st.session_state['pending_update'] = None
            st.success("Changes applied!")
            st.rerun()

    # Display Chat
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    if prompt := st.chat_input("Ask a question..."):
        with st.chat_message("user"): st.markdown(prompt)
        with st.spinner("Assistant is thinking..."):
            get_ai_diagnostic(user_input=prompt)
            st.rerun()

    if st.button("🗑️ Clear Chat History"):
        st.session_state.messages = []
        st.session_state['pending_update'] = None
        st.rerun()

st.title("💧 Ion Exchange Demineralization (DM) Plant Simulator")

# 1. Download Template Button
if os.path.exists(config_path):
    with open(config_path, "rb") as file:
        st.download_button(
            label="📥 Download DM Configuration Template (Excel)",
            data=file,
            file_name="dm_plant_config_template.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
else:
    st.warning("Default template not found. Please run generate_dm_config.py first.")

st.divider()

# --- MAIN TABLE EDITORS ---
tab1, tab2, tab3 = st.tabs(["Global & Incoming Parameters", "Tank Buffer Capacities", "Chemical Units (Resins, Speeds, Failures)"])

with tab1:
    edited_globals = st.data_editor(st.session_state['df_globals'], use_container_width=True, key="editor_global")
    st.session_state['df_globals'] = edited_globals # Sync manual edits
    
with tab2:
    edited_tanks = st.data_editor(st.session_state['df_tanks'], use_container_width=True, key="editor_tanks")
    st.session_state['df_tanks'] = edited_tanks
    
with tab3:
    edited_machines = st.data_editor(st.session_state['df_machines'], use_container_width=True, key="editor_machines")
    st.session_state['df_machines'] = edited_machines

st.divider()

if st.button("🚀 Simulate Chemical Plant", type="primary"):
    with st.spinner("Processing continuous simulation vectors..."):
        results = run_dm_simulation(st.session_state['df_globals'], st.session_state['df_tanks'], st.session_state['df_machines'], sim_time=50000)
        st.session_state['dm_results'] = results
        st.session_state['run_auto_ai'] = True # Trigger Proactive AI
        st.rerun() # Rerun to let the sidebar AI start

if 'dm_results' in st.session_state:
    res = st.session_state['dm_results']
    
    if res['System_Failed']:
        st.error("🚨 CRITICAL SYSTEM OVERFLOW: The system halted because W1_RawWater exceeded its physical safe capacity constraint!")
    else:
        st.success(f"Simulation completed normally! Processed {res['Batches_Processed']} discrete batches.")
        
    c1, c2, c3 = st.columns(3)
    c1.metric("Makespan (Simulation Minutes)", f"{round(res['Time'],2)}")
    c2.metric("Total Quality Violations", f"{res['Quality_Violations']}")
    c3.metric("Processed Batches", f"{res['Batches_Processed']}")
    
    st.divider()

    # --- NEW STAKEHOLDER EXECUTIVE SUMMARY ---
    st.subheader("📊 Executive Summary & OEE Insights")
    st.markdown("This breakdown calculates exactly how the plant spends its time, isolating **Value-Added Processing** from **Chemical Downtime (Regeneration)** and **Mechanical Failures**.")
    
    state_df = res['State_Log'].sort_values(['Machine', 'Time'])
    state_df['Duration'] = state_df.groupby('Machine')['Time'].diff().shift(-1)
    state_df['Duration'] = state_df['Duration'].fillna(res['Time'] - state_df['Time'])
    
    # Aggregate durations per machine per state
    agg_states = state_df.groupby(['Machine', 'State'])['Duration'].sum().unstack(fill_value=0)
    
    # Calculate Percentages
    for col in ['Processing', 'Setup', 'Failure', 'Idle']:
        if col not in agg_states.columns:
            agg_states[col] = 0.0

    total_m_times = agg_states.sum(axis=1)
    agg_pct = agg_states.div(total_m_times, axis=0) * 100
    
    # Rename 'Setup' to 'Regeneration' for clarity
    if 'Setup' in agg_pct.columns:
        agg_pct = agg_pct.rename(columns={'Setup': 'Regeneration'})
        
    # Reorder columns for better visibility (Processing -> Regeneration -> Idle -> Failure)
    logical_order = [c for c in ['Processing', 'Regeneration', 'Idle', 'Failure'] if c in agg_pct.columns]
    agg_pct = agg_pct[logical_order]
        
    st.session_state['agg_pct'] = agg_pct # Store for AI context

    # Display OEE Table
    st.dataframe(agg_pct.round(1).astype(str) + " %", use_container_width=True)
    
    if 'Regeneration' in agg_pct.columns and agg_pct['Regeneration'].max() == 0:
        st.warning("ℹ️ **No Regenerations Occurred**: The current resin capacity is so large compared to the number of batches that the trigger threshold (90%) was never reached. Try reducing 'Max_Resin_Capacity_eq' in the Machines tab to see cleaning cycles!")

    # Generate automatic insight string based on lowest processing % or highest Setup %
    worst_idle = agg_pct['Idle'].idxmax() if 'Idle' in agg_pct else "N/A"
    worst_regen = agg_pct['Regeneration'].idxmax() if 'Regeneration' in agg_pct else "N/A"
    
    st.info(f"💡 **Bottleneck Insight:** The unit `{worst_idle}` spent the most time sitting strictly **Idle** ({round(agg_pct.loc[worst_idle, 'Idle'], 1)}%), meaning it is constantly starved for water or blocked by downstream tanks. \n\n"
            f"💡 **Chemical Exhaustion Insight:** The unit `{worst_regen}` suffered the worst chemical downtime, spending **{round(agg_pct.loc[worst_regen, 'Regeneration'], 1)}%** of the entire simulation purely offline for Regeneration scrubbing.")

    st.divider()
    
    # --- CHART 1: SEPARATED TANK LEVELS ---
    st.subheader("🌊 Continuous Tank Volume Levels")
    df_tanks_log = res['Tank_Log']
    if not df_tanks_log.empty:
        df_melt = df_tanks_log.melt(id_vars=['Time'], var_name='Tank', value_name='Volume_m3')
        
        # 1. Fluctuating Tanks (Levels) - including W1 through W4
        fluctuating_tanks = ['W1_RawWater', 'W2_W3_Buffer', 'W3_W4_Buffer', 'W4_W5_Buffer']
        df_fluct = df_melt[df_melt['Tank'].isin(fluctuating_tanks)]
        
        # 2. Cumulative Productivity (W5)
        df_prod = df_melt[df_melt['Tank'] == 'W5_Output_Tank']
        
        c_chart1, c_chart2 = st.columns([2, 1])
        with c_chart1:
            st.markdown("### 🔍 Real-Time Tank Levels (Fluctuations)")
            fig_int = px.line(df_fluct, x="Time", y="Volume_m3", color="Tank",
                          facet_row="Tank", # This separates them into clean stacked subplots
                          title="Instantaneous Volume Tracking (Faceted View)",
                          line_shape="hv",
                          height=600)
            fig_int.update_yaxes(matches=None) # Allow each tank to have its own scale
            st.plotly_chart(fig_int, use_container_width=True)
            st.caption("Faceted view allows you to see the individual 'heartbeat' of each tank without overlapping 'smudges'.")
            
        with c_chart2:
            st.markdown("### 📈 Plant Productivity")
            fig_main = px.line(df_prod, x="Time", y="Volume_m3", color="Tank",
                          title="Cumulative Purified Water Output",
                          line_shape="linear")
            st.plotly_chart(fig_main, use_container_width=True)
            st.caption("This tracks the total volume of pure water collected over the entire simulation duration.")
        
    # Chart 2: Chemical Resin Load Tracking
    st.divider()
    st.subheader("⚗️ Resin Ion Load Exhaustion (Chemical Tracking)")
    st.markdown("Watch the Resin Load incrementally climb. Once it hits the maximum capacity (or the quality violation threshold), it forces a lengthy Regeneration cycle, clearing the load back to `0`.")
    df_resin_log = res['Resin_Log']
    if not df_resin_log.empty:
        df_rmelt = df_resin_log.melt(id_vars=['Time'], var_name='Machine', value_name='Chemical_Load_eq')
        # Filter out machines that don't track resin (like W3_Degasser)
        df_rmelt = df_rmelt[df_rmelt['Chemical_Load_eq'] > 0]
        fig2 = px.line(df_rmelt, x="Time", y="Chemical_Load_eq", color="Machine",
                       title="Sawtooth Chemical Resin Loading & Regeneration Dumps",
                       line_shape="linear") # Use linear for gradual filling visualization
        st.plotly_chart(fig2, use_container_width=True)

    # Chart 3: Categorical Machine State Flow Graphs
    st.divider()
    st.subheader("⚙️ Machine Status Timelines")
    st.markdown("Heart-rate monitor style charts showing exactly when each machine switches between **Processing**, **Idle**, **Setup** (Regeneration), and **Failure**.")
    
    state_df_full = res['State_Log'].copy()
    if not state_df_full.empty:
        machine_options = state_df_full["Machine"].unique().tolist()
        selected_machine = st.selectbox("Select target Machine timeline:", ["All Machines Overlaid"] + machine_options)
        
        if selected_machine == "All Machines Overlaid":
            fig3 = px.line(state_df_full, x="Time", y="State", color="Machine", 
                           title="All Operations Combined", line_shape='hv')
        else:
            m_state = state_df_full[state_df_full['Machine'] == selected_machine]
            fig3 = px.line(m_state, x="Time", y="State", 
                           title=f"{selected_machine} Operations Timeline", line_shape='hv')
            
        fig3.update_yaxes(categoryorder="array", categoryarray=["Failure", "Idle", "Setup", "Processing"])
        st.plotly_chart(fig3, use_container_width=True)

    # Event Log Unabridged
    st.divider()
    st.subheader("📜 Complete Telemetry Event Log")
    st.markdown("A complete chronologically ordered log of every single batch arrival, blockage, failure, repair, and quality test from start to finish.")
    st.dataframe(res['Event_Log'], height=600, use_container_width=True)
