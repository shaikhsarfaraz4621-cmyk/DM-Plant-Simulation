from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sim_engine
import excel_parser
from typing import Dict, Any, List
import requests
import os
import copy

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulationRequest(BaseModel):
    config: Dict[str, Any]

class ChatMessage(BaseModel):
    role: str
    content: str

class AnalyzeRequest(BaseModel):
    throughput: float
    violations: float
    prompt: str
    history: List[ChatMessage] = []

class WhatIfRequest(BaseModel):
    config: Dict[str, Any]
    prompt: str

@app.api_route("/", methods=["GET", "HEAD"])
async def root_health():
    return {"status": "online", "system": "DM Plant Digital Twin"}

@app.post("/simulate")
async def run_simulation(req: SimulationRequest):
    try:
        results = sim_engine.run_scenario(req.config)
        return {"status": "success", "results": results}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/parse-excel")
async def parse_excel_file(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        config = excel_parser.parse_excel_to_config(contents)
        return {"status": "success", "config": config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel parsing error: {str(e)}")

@app.get("/default-config")
async def get_default_config():
    target_file = "dm_plant_config.xlsx"
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", target_file),
        os.path.join(os.path.dirname(__file__), target_file),
        target_file,
    ]
    for path in candidates:
        if os.path.exists(path):
            with open(path, "rb") as f:
                contents = f.read()
            config = excel_parser.parse_excel_to_config(contents)
            return {
                "status": "success",
                "config": config,
                "problem_name": "Demineralisation Plant - Standard Operation",
                "problem_file": target_file,
            }
    raise HTTPException(status_code=404, detail=f"Default config file ({target_file}) not found.")

@app.post("/analyze")
async def analyze_results(req: AnalyzeRequest):
    api_key = os.environ.get("DEEPSEEK_API_KEY", "sk-84b78e39161d49e081bb04d0fcc99fd9")
    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        system_content = (
            f"You are a Chemical Plant Simulation Analyst. Provide structured, professional responses. "
            f"Simulation results: {req.throughput:.1f} batches processed. "
            f"Quality Violations: {req.violations:.1f} events. "
            f"Analyze the efficiency of the DM plant and provide 1. Summary, 2. Bottleneck Analysis, 3. Action Items."
        )
        messages = [{"role": "system", "content": system_content}]
        for msg in req.history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": req.prompt})
        payload = {"model": "deepseek-chat", "messages": messages}
        res = requests.post("https://api.deepseek.com/chat/completions", json=payload, headers=headers)
        if res.status_code == 200:
            analysis = res.json()["choices"][0]["message"]["content"]
            return {"analysis": analysis}
        else:
            return {"analysis": f"AI Error {res.status_code}. Manual insight: Throughput of {req.throughput} with {req.violations} violations."}
    except Exception as e:
        return {"analysis": "AI Analysis Offline."}

@app.post("/what-if")
async def check_what_if(req: WhatIfRequest):
    api_key = os.environ.get("DEEPSEEK_API_KEY", "sk-84b78e39161d49e081bb04d0fcc99fd9")
    try:
        nodes_summary = ", ".join([f"{n['name']} (Flow:{n.get('flow_rate',1)}m3/m, Resin:{n.get('max_resin_cap',0)}eq)" for n in req.config.get("nodes",[]) if n['type']=='machine'])
        system_prompt = (
            "You are a Senior Plant Engineer. Extract proposed DM plant changes. "
            f"Current Config: {nodes_summary}. "
            "Possible fields: 'flow_rate' (m3/min), 'max_resin_cap' (eq), 'regen_threshold' (%). "
            "Output ONLY a JSON list: [{\"name\": \"Node Name\", \"field\": \"flow_rate|max_resin_cap|regen_threshold\", \"value\": 1.5}]. "
            "If no change found, return []"
        )
        
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {"model": "deepseek-chat", "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": req.prompt}]}
        
        res_llm = requests.post("https://api.deepseek.com/chat/completions", json=payload, headers=headers)
        delta = []
        if res_llm.status_code == 200:
            content = res_llm.json()["choices"][0]["message"]["content"]
            import json, re
            match = re.search(r'\[.*\]', content.replace('\n', ''), re.DOTALL)
            if match:
                try: delta = json.loads(match.group())
                except: delta = []

        new_config = copy.deepcopy(req.config)
        changes_applied = []
        for change in delta:
            target_name = change.get("name", "").lower()
            field = change.get("field")
            val = change.get("value")
            
            for node in new_config.get("nodes", []):
                if node["name"].lower() == target_name:
                    if field == 'flow_rate':
                        old = node.get('flow_rate', 1.0)
                        node['flow_rate'] = float(val)
                        changes_applied.append(f"{node['name']} Flow: {old} -> {node['flow_rate']} m3/min")
                    elif field == 'max_resin_cap':
                        old = node.get('max_resin_cap', 0)
                        node['max_resin_cap'] = float(val)
                        changes_applied.append(f"{node['name']} Resin Cap: {old} -> {val} eq")
                    elif field == 'regen_threshold':
                        old = node.get('regen_threshold', 90)
                        node['regen_threshold'] = float(val)
                        changes_applied.append(f"{node['name']} Regen Threshold: {old}% -> {val}%")

        if not changes_applied:
            return {"analysis": "I couldn't identify specific parameter changes. Try: 'Make the Anion unit 20% faster' or 'Increase resin capacity on Mixed Bed'.", "delta": []}

        sim_runs = 10
        baseline_config = copy.deepcopy(req.config)
        baseline_config["runs"] = sim_runs
        delta_config = copy.deepcopy(new_config)
        delta_config["runs"] = sim_runs
        
        baseline_results = sim_engine.run_scenario(baseline_config)
        delta_results = sim_engine.run_scenario(delta_config)
        
        return {
            "status": "success",
            "changes": changes_applied,
            "baseline_results": baseline_results,
            "delta_results": delta_results,
            "analysis": f"Predictive plant analysis complete. Applied: {', '.join(changes_applied)}."
        }
    except Exception as e:
        return {"analysis": f"Error in What-If: {str(e)}", "delta": []}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
