import streamlit as st
import pandas as pd
import os

def initialize_session_state():
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "pending_update" not in st.session_state:
        st.session_state.pending_update = None
    if "run_auto_ai" not in st.session_state:
        st.session_state.run_auto_ai = False
    if "df_globals" not in st.session_state:
        st.session_state.df_globals = None

def load_initial_data(config_path):
    if st.session_state.df_globals is None:
        if os.path.exists(config_path):
            st.session_state['df_globals'] = pd.read_excel(config_path, sheet_name="Global_Parameters")
            st.session_state['df_tanks'] = pd.read_excel(config_path, sheet_name="Tanks")
            st.session_state['df_machines'] = pd.read_excel(config_path, sheet_name="Machines")
        else:
            st.error(f"Configuration not found at {config_path}")
            st.stop()

def handle_file_upload(uploaded_file):
    if uploaded_file is not None:
        if st.session_state.get('last_uploaded') != uploaded_file.name:
            st.session_state['df_globals'] = pd.read_excel(uploaded_file, sheet_name="Global_Parameters")
            st.session_state['df_tanks'] = pd.read_excel(uploaded_file, sheet_name="Tanks")
            st.session_state['df_machines'] = pd.read_excel(uploaded_file, sheet_name="Machines")
            st.session_state['last_uploaded'] = uploaded_file.name
            st.success("Custom configuration loaded!")
