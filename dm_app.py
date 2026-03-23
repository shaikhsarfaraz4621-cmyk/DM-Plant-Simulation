import streamlit as st
import os
import pandas as pd

# Import modular components
from engine import run_dm_simulation
from ai_assistant import get_ai_diagnostic
from data_handler import initialize_session_state, load_initial_data, handle_file_upload
from ui_components import apply_custom_css, render_header, render_oee_metrics, render_charts

# --- PAGE CONFIG ---
st.set_page_config(page_title="DM Plant Pro Simulation", layout="wide", page_icon="💧")

# --- INITIALIZATION ---
apply_custom_css()
initialize_session_state()

current_dir = os.path.dirname(__file__)
config_path = os.path.join(current_dir, "dm_stress_config.xlsx")

# --- HEADER ---
render_header()

# --- TOP CONTROLS ---
c1, c2 = st.columns([1, 3])
with c1:
    if st.button("🔄 Reset Environment", help="Clear results and AI history"):
        for key in ['dm_results', 'agg_pct', 'pending_update', 'run_auto_ai']:
            if key in st.session_state: del st.session_state[key]
        st.session_state.messages = []
        st.rerun()

with c2:
    uploaded_file = st.file_uploader("📂 Upload Configuration (.xlsx)", type=["xlsx"])
    handle_file_upload(uploaded_file)

# --- DATA LOADING ---
load_initial_data(config_path)

# --- AI SIDEBAR ---
with st.sidebar:
    st.title("🤖 AI Assistant")
    
    if st.session_state.get('run_auto_ai'):
        with st.spinner("AI Analyzing..."):
            get_ai_diagnostic(is_auto=True)
            st.session_state['run_auto_ai'] = False
            st.rerun()

    if st.session_state.get('pending_update'):
        st.info("💡 AI Optimizations Suggestion!")
        if st.button("✅ Apply Suggestions", use_container_width=True):
            update = st.session_state['pending_update']
            if "Global" in update:
                for k, v in update["Global"].items():
                    st.session_state['df_globals'].loc[st.session_state['df_globals']['Parameter'] == k, 'Value'] = v
            if "Machines" in update:
                for mid, params in update["Machines"].items():
                    for k, v in params.items():
                        st.session_state['df_machines'].loc[st.session_state['df_machines']['Machine_ID'] == mid, k] = v
            st.session_state['pending_update'] = None
            st.success("Applied!")
            st.rerun()

    for message in st.session_state.messages:
        with st.chat_message(message["role"]): st.markdown(message["content"])

    if prompt := st.chat_input("Ask about the simulation..."):
        with st.chat_message("user"): st.markdown(prompt)
        with st.spinner("Thinking..."):
            get_ai_diagnostic(user_input=prompt)
            st.rerun()

    if st.button("🗑️ Clear Chat"):
        st.session_state.messages = []; st.rerun()

# --- MAIN INTERFACE ---
st.divider()
tab1, tab2, tab3 = st.tabs(["Globals", "Tanks", "Chemical Units"])
with tab1:
    st.session_state['df_globals'] = st.data_editor(st.session_state['df_globals'], use_container_width=True, key="ed_g")
with tab2:
    st.session_state['df_tanks'] = st.data_editor(st.session_state['df_tanks'], use_container_width=True, key="ed_t")
with tab3:
    st.session_state['df_machines'] = st.data_editor(st.session_state['df_machines'], use_container_width=True, key="ed_m")

st.divider()

if st.button("🚀 Run Digital Twin Simulation", type="primary"):
    with st.spinner("Running SimPy Engine..."):
        st.session_state.messages = [] # Refresh chat for new run
        results = run_dm_simulation(st.session_state['df_globals'], st.session_state['df_tanks'], st.session_state['df_machines'], sim_time=50000)
        st.session_state['dm_results'] = results
        st.session_state['run_auto_ai'] = True
        st.rerun()

# --- RESULTS RENDERING ---
if 'dm_results' in st.session_state:
    res = st.session_state['dm_results']
    
    if res['System_Failed']:
        st.error("🚨 CRITICAL OVERFLOW DETECTED")
    else:
        st.success(f"Simulation Success! Batches: {res['Batches_Processed']}")
        
    m1, m2, m3 = st.columns(3)
    m1.metric("Sim Time", f"{round(res['Time'],1)}m")
    m2.metric("Quality Violations", res['Quality_Violations'])
    m3.metric("Batches", res['Batches_Processed'])
    
    st.divider()
    st.subheader("📊 Performance & OEE")
    render_oee_metrics(res)
    
    st.divider()
    render_charts(res)
    
    with st.expander("📜 Full Event Telemetry"):
        st.dataframe(res['Event_Log'], use_container_width=True)
