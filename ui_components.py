import streamlit as st
import plotly.express as px
import pandas as pd
import os

def apply_custom_css():
    st.markdown("""
        <style>
        .stMetric { 
            padding: 18px; 
            border-radius: 10px; 
            border: 1px solid rgba(128, 128, 128, 0.2);
            background-color: rgba(128, 128, 128, 0.05);
        }
        .stDataFrame, [data-testid="stDataFrameResizable"] {
            border: none !important;
            background: transparent !important;
        }
        .stTabs [data-baseweb="tab-panel"] { 
            padding: 20px 0px; 
            border: none !important;
            background-color: transparent !important;
        }
        .stButton>button { border-radius: 8px; font-weight: 600; transition: all 0.3s; }
        h1, h2, h3 { font-family: 'Inter', sans-serif; }
        div[data-testid="stSidebar"] { border-right: 1px solid rgba(128, 128, 128, 0.15); }
        </style>
    """, unsafe_allow_html=True)

def render_header():
    c1, c2 = st.columns([1, 4])
    with c1:
        logo_path = os.path.join(os.path.dirname(__file__), "logo.png")
        if os.path.exists(logo_path):
            st.image(logo_path, width=120)
    with c2:
        st.title("💧 Demineralization (DM) Plant | Digital Twin")
        st.markdown("*Precision Ion-Exchange Simulation & AI Diagnostics*")

def render_oee_metrics(res):
    state_df = res['State_Log'].sort_values(['Machine', 'Time'])
    state_df['Duration'] = state_df.groupby('Machine')['Time'].diff().shift(-1)
    state_df['Duration'] = state_df['Duration'].fillna(res['Time'] - state_df['Time'])
    
    agg_states = state_df.groupby(['Machine', 'State'])['Duration'].sum().unstack(fill_value=0)
    for col in ['Processing', 'Setup', 'Failure', 'Idle']:
        if col not in agg_states.columns: agg_states[col] = 0.0

    agg_pct = agg_states.div(agg_states.sum(axis=1), axis=0) * 100
    if 'Setup' in agg_pct.columns:
        agg_pct = agg_pct.rename(columns={'Setup': 'Regeneration'})
        
    order = [c for c in ['Processing', 'Regeneration', 'Idle', 'Failure'] if c in agg_pct.columns]
    agg_pct = agg_pct[order]
    st.session_state['agg_pct'] = agg_pct
    
    st.dataframe(agg_pct.round(1).astype(str) + " %", use_container_width=True)
    return agg_pct

def render_charts(res):
    # --- Chart 1: Tank Levels ---
    st.subheader("🌊 Continuous Tank Volume Levels")
    df_tanks_log = res['Tank_Log']
    if not df_tanks_log.empty:
        df_melt = df_tanks_log.melt(id_vars=['Time'], var_name='Tank', value_name='Volume_m3')
        fluct = ['W1_RawWater', 'W2_W3_Buffer', 'W3_W4_Buffer', 'W4_W5_Buffer']
        df_fluct = df_melt[df_melt['Tank'].isin(fluct)]
        df_prod = df_melt[df_melt['Tank'] == 'W5_Output_Tank']

        c_chart1, c_chart2 = st.columns([2, 1])
        with c_chart1:
            st.markdown("### 🔍 Real-Time Tank Levels")
            fig_int = px.line(df_fluct, x="Time", y="Volume_m3", color="Tank",
                          facet_row="Tank", title="Instantaneous Volume Tracking",
                          line_shape="hv", height=600)
            fig_int.update_yaxes(matches=None)
            st.plotly_chart(fig_int, use_container_width=True)
        with c_chart2:
            st.markdown("### 📈 Plant Productivity")
            fig_main = px.line(df_prod, x="Time", y="Volume_m3", color="Tank",
                          title="Cumulative Purified Water Output", line_shape="linear")
            st.plotly_chart(fig_main, use_container_width=True)

    # --- Chart 2: Resin Loads ---
    st.divider()
    st.subheader("⚗️ Resin Ion Load Exhaustion")
    df_resin_log = res['Resin_Log']
    if not df_resin_log.empty:
        df_rmelt = df_resin_log.melt(id_vars=['Time'], var_name='Machine', value_name='Load_eq')
        df_rmelt = df_rmelt[df_rmelt['Load_eq'] > 0]
        fig2 = px.line(df_rmelt, x="Time", y="Load_eq", color="Machine",
                       title="Sawtooth Chemical Resin Loading & Regeneration Dumps")
        st.plotly_chart(fig2, use_container_width=True)

    # --- Chart 3: Machine Status Timelines (Heart-rate Style) ---
    st.divider()
    st.subheader("⚙️ Machine Status Timelines")
    st.markdown("Heart-rate monitor style chart — watch each machine switch between **Processing**, **Idle**, **Setup** (Regen), and **Failure**.")
    state_df_full = res['State_Log'].copy()
    if not state_df_full.empty:
        machine_options = sorted(state_df_full["Machine"].unique().tolist())
        all_options = ["All Machines Overlaid"] + machine_options
        
        # Default to W2_Cation if available
        default_index = 0
        if "W2_Cation" in all_options:
            default_index = all_options.index("W2_Cation")
            
        selected = st.selectbox("Select machine timeline:", all_options, index=default_index)

        if selected == "All Machines Overlaid":
            fig3 = px.line(state_df_full, x="Time", y="State", color="Machine",
                           title="All Operations Combined", line_shape='hv')
        else:
            m_state = state_df_full[state_df_full['Machine'] == selected]
            fig3 = px.line(m_state, x="Time", y="State",
                           title=f"{selected} Status Timeline", line_shape='hv')

        fig3.update_yaxes(categoryorder="array", categoryarray=["Failure", "Idle", "Setup", "Processing"])
        st.plotly_chart(fig3, use_container_width=True)
