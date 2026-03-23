import streamlit as st
import json
from openai import OpenAI

def get_safe_api_key():
    try:
        return st.secrets["DEEPSEEK_API_KEY"]
    except:
        return "sk-84b78e39161d49e081bb04d0fcc99fd9"

def get_ai_diagnostic(user_input=None, is_auto=False):
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    # 1. Prepare Context
    g_context = st.session_state['df_globals'].to_json(orient='records')
    m_cols = ['Machine_ID', 'Flow_Rate_m3_min', 'Max_Resin_Capacity_eq', 'Regen_Trigger_Percentage_pct']
    m_context = st.session_state['df_machines'][m_cols].to_json(orient='records')
    
    res_context = "No simulation run yet."
    if 'dm_results' in st.session_state:
        r = st.session_state['dm_results']
        res_context = f"Last Run: Batches={r['Batches_Processed']}, Violations={r['Quality_Violations']}, Failed={r['System_Failed']}"
        if 'agg_pct' in st.session_state:
            res_context += f" | OEE Stats: {st.session_state['agg_pct'].to_json()}"

    system_prompt = f"""You are an expert DM Plant Consultant.
    CURRENT CONFIG: {g_context}
    MACHINES: {m_context}
    RESULTS: {res_context}

    Goal: Be PROACTIVE. If you see a bottleneck, suggest a fix in JSON format:
    ```json
    {{ "Update": {{ "Global": {{"Interarrival_Mean_min": 5.0}}, "Machines": {{"W2_Cation": {{"Flow_Rate_m3_min": 2.5}}}} }} }}
    ```"""

    if is_auto:
        st.session_state.messages.append({"role": "user", "content": "🔄 [System Trigger] Simulation complete. Please analyze results."})
    elif user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})

    try:
        client = OpenAI(api_key=get_safe_api_key(), base_url="https://api.deepseek.com")
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "system", "content": system_prompt}, *st.session_state.messages]
        )
        ai_message = response.choices[0].message.content
        st.session_state.messages.append({"role": "assistant", "content": ai_message})
        
        if "```json" in ai_message:
            js = ai_message.split("```json")[1].split("```")[0].strip()
            st.session_state['pending_update'] = json.loads(js).get("Update")
    except Exception as e:
        st.error(f"AI Assistant Error: {str(e)}")
