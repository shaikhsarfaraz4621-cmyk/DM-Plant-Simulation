import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  MarkerType,
  Handle,
  Position,
  EdgeLabelRenderer
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  LayoutDashboard, ClipboardList, Cpu, Bell, ScrollText,
  Settings, Send, Download, Play, Pause, Zap, AlertTriangle,
  CheckCircle2, Trophy, Package, Bot, Trash2, Upload,
  Eye, EyeOff, Layout, Plus, Trash, ChevronRight, ChevronLeft, RotateCcw, Droplets, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { create } from 'zustand';
import { interpolate } from 'd3-interpolate';
import { getBezierPath } from 'reactflow';
import './index.css';

const CHART_COLORS = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#e11d48'];
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const STATE_PALETTE = { 
  'PROCESSING': '#22c55e', 
  'SETUP':      '#3b82f6', 
  'WAITING':    '#f59e0b',
  'IDLE':       '#94a3b8',
  'DOWN':       '#ef4444',
  'STARVED':    '#64748b'
};

const PIE_COLORS = [
  '#22c55e', // PROCESSING
  '#3b82f6', // SETUP
  '#f59e0b', // WAITING/STARVED
  '#ef4444', // DOWN
  '#94a3b8', // IDLE
];

const getHardnessColor = (h) => {
  // Hardness 250 (Raw) -> Red/Orange, Hardness 0 (DM) -> Blue/Cyan
  const clamped = Math.max(0, Math.min(250, h || 0));
  const ratio = clamped / 250;
  const hue = (1 - ratio) * 210; // 0 is red, 210 is blue/cyan
  return `hsl(${hue}, 85%, 50%)`;
};

const JOB_COLORS = [
  '#3b82f6', // Bright Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#ec4899', // Pink
];

const getJobColor = (jobName) => {
  if (!jobName) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < jobName.length; i++) {
    hash = jobName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return JOB_COLORS[Math.abs(hash) % JOB_COLORS.length];
};

const getMachineColor = (name) => {
  if (!name) return '#f1f5f9';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % JOB_COLORS.length;
  return JOB_COLORS[colorIndex];
};

/* ─── SIMULATION PLAYBACK STORE (ZUSTAND) ────────────────────────── */
const useSimStore = create((set, get) => ({
  currentTime: 0,
  isPlaying: false,
  playSpeed: 1, // Scaled minutes per real second
  eventTrace: [],
  queueTrace: {}, // New: stores historical queue levels
  results: null,
  totalTime: 1440,
  
  setTrace: (trace, total, queue = {}, results = null) => set({ 
    eventTrace: trace, 
    totalTime: total, 
    queueTrace: queue,
    results: results,
    currentTime: 0, 
    isPlaying: true 
  }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setSpeed: (speed) => set({ playSpeed: speed }),
  setCurrentTime: (t) => set({ currentTime: t }),
  reset: () => set({ currentTime: 0, isPlaying: false, queueTrace: {}, results: null }),
  
  // Advance the clock based on deltatime
  tick: (dt) => {
    const { isPlaying, playSpeed, currentTime, totalTime } = get();
    if (!isPlaying || totalTime === 0) return;
    const nextTime = currentTime + (dt * (playSpeed / 1000));
    if (nextTime >= totalTime) {
      set({ currentTime: totalTime, isPlaying: false });
    } else {
      set({ currentTime: nextTime });
    }
  },
  
  getSnapshot: () => ({
    currentTime: get().currentTime,
    playSpeed: get().playSpeed,
    eventTrace: get().eventTrace,
    queueTrace: get().queueTrace
  })
}));

/* ─── LIVE PACKAGE COMPONENT ────────────────────────── */
const LivePackage = ({ path, color, progress, hardness }) => {
  const pathRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const totalLength = useRef(0);

  const particleColor = hardness !== undefined ? getHardnessColor(hardness) : color;

  useEffect(() => {
    if (!pathRef.current) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', path);
        pathRef.current = p;
        totalLength.current = p.getTotalLength();
    }
  }, [path]);

  useEffect(() => {
    const safeProgress = Math.max(0, Math.min(1, progress || 0));
    try {
      if (totalLength.current === 0) return;
      const point = pathRef.current.getPointAtLength(totalLength.current * safeProgress);
      if (point) setPos({ x: point.x, y: point.y });
    } catch (e) {}
  }, [progress]);

  if (!pos.x && !pos.y) return null;

  return (
    <g style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <circle r={7} fill={particleColor} style={{ filter: `drop-shadow(0 0 10px ${particleColor})`, stroke: 'white', strokeWidth: 1.5 }} />
    </g>
  );
};

/* ─── PLAYBACK CONTROLLER ────────────────────────────── */
const PlaybackController = () => {
  const isPlaying = useSimStore(s => s.isPlaying);
  const currentTime = useSimStore(s => s.currentTime);
  const playSpeed = useSimStore(s => s.playSpeed);
  const hasTrace = useSimStore(s => s.eventTrace.length > 0);
  const togglePlay = useSimStore(s => s.togglePlay);
  const setSpeed = useSimStore(s => s.setSpeed);
  const reset = useSimStore(s => s.reset);

  if (!hasTrace) return null;

  const days = Math.floor(currentTime / 1440);
  const hrs = Math.floor((currentTime % 1440) / 60);
  const mins = Math.floor(currentTime % 60);
  const timeStr = `D${days+1} ${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;

  return (
    <div style={{ position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:100, display:'flex', alignItems:'center', gap:'1.5rem', background:'rgba(15,23,42,0.85)', backdropFilter:'blur(12px)', padding:'0.75rem 2rem', borderRadius:100, border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.3)' }}>
      <button 
        onClick={togglePlay}
        style={{ background:'#3b82f6', border:'none', width:40, height:40, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', color:'white', cursor:'pointer' }}
      >
        {isPlaying ? <Pause size={20} fill="white"/> : <Play size={20} fill="white"/>}
      </button>

      <div style={{ display:'flex', flexDirection:'column', minWidth:120 }}>
        <div style={{ fontSize:'0.7rem', color:'#94a3b8', textTransform:'uppercase', fontWeight:700, letterSpacing:1 }}>Virtual Time</div>
        <div style={{ fontSize:'1.1rem', color:'white', fontWeight:800, fontFamily:'monospace' }}>{timeStr}</div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'1rem', borderLeft:'1px solid rgba(255,255,255,0.1)', paddingLeft:'1.5rem' }}>
        <div style={{ fontSize:'0.7rem', color:'#94a3b8', textTransform:'uppercase', fontWeight:700 }}>Engine Speed</div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <input 
            type="range" min="0.1" max="500" step="0.1" 
            value={playSpeed} 
            onChange={e => setSpeed(parseFloat(e.target.value))}
            style={{ width:120, accentColor:'#3b82f6' }}
          />
          <span style={{ fontSize:'0.85rem', color:'white', fontWeight:700, minWidth:45 }}>{playSpeed.toFixed(1)}x</span>
        </div>
      </div>

      <button onClick={reset} style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'white', padding:'0.4rem 0.8rem', borderRadius:8, fontSize:'0.7rem', fontWeight:700, cursor:'pointer' }}>
        RESET
      </button>
    </div>
  );
};

/* ─── CUSTOM ANIMATED EDGE ────────────────────────────────────────────── */
const AnimatedEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, source, target, label, data }) => {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  
  const currentTime = useSimStore(s => s.currentTime);
  const eventTrace = useSimStore(s => s.eventTrace);
  const queueTrace = useSimStore(s => s.queueTrace);
  const playSpeed = useSimStore(s => s.playSpeed);

  // Buffer Stats Calc
  const bufferStats = useMemo(() => {
    if (!data?.trail || !queueTrace) return null;
    let totalLevel = 0;
    data.trail.forEach(buf => {
       const snapshots = queueTrace[buf] || [];
       if (snapshots.length === 0) return;
       // Find closest snapshot in time
       const snap = snapshots.reduce((prev, curr) => {
         return (Math.abs(curr.t - currentTime) < Math.abs(prev.t - currentTime) ? curr : prev);
       });
       totalLevel += snap.count || 0;
    });
    return totalLevel;
  }, [data, queueTrace, currentTime]);

  // DYNAMIC TRANSIT: At high speeds, we stretch the visual transit time so objects don't flicker.
  const VISUAL_TRANSIT_MINS = useMemo(() => {
    if (playSpeed > 200) return 30;
    if (playSpeed > 50) return 15;
    return 8;
  }, [playSpeed]);

  const activeTransits = useMemo(() => {
    const isNodeMatch = (probe, base) => {
        if (!probe || !base) return false;
        if (probe === base) return true;
        if (probe.startsWith(base + "_")) {
            const suffix = probe.substring(base.length + 1);
            return /^\d+$/.test(suffix);
        }
        return false;
    };

    if (!eventTrace || eventTrace.length === 0) return [];

    return eventTrace.filter(e => {
        if (e.type !== 'TRANSIT_START') return false;
        if (e.t > currentTime || e.t + VISUAL_TRANSIT_MINS <= currentTime) return false;
        return isNodeMatch(e.node, source) && isNodeMatch(e.data?.to, target);
    });
  }, [eventTrace, source, target, currentTime]);

  return (
    <>
      <path id={id} style={{ ...style, strokeWidth: 3, stroke: '#e2e8f0' }} className="react-flow__edge-path" d={edgePath} markerEnd={markerEnd} />
      
      <AnimatePresence>
        {activeTransits.map(ev => {
          const progress = (currentTime - ev.t) / VISUAL_TRANSIT_MINS;
          const materialType = ev.mat || 'Standard';
          return (
            <LivePackage 
              key={ev.data.part_id} 
              path={edgePath} 
              color={getJobColor(materialType)} 
              partId={ev.data.part_id} 
              progress={progress} 
              hardness={ev.data?.hardness}
            />
          );
        })}
      </AnimatePresence>
      
      {/* BUFFER / CAPACITY LABEL */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${sourceX + (targetX - sourceX) / 2}px, ${sourceY + (targetY - sourceY) / 2}px)`,
            background: bufferStats > 0 ? '#eff6ff' : 'white',
            padding: '6px 12px',
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 800,
            color: bufferStats > 0 ? '#1d4ed8' : '#64748b',
            boxShadow: bufferStats > 0 ? '0 10px 15px -3px rgba(59, 130, 246, 0.2)' : '0 4px 6px -1px rgba(0,0,0,0.1)',
            border: `2px solid ${bufferStats > 0 ? '#3b82f6' : '#e2e8f0'}`,
            pointerEvents: 'none',
            zIndex: 1000,
            fontFamily: 'var(--font-display)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          className="nodrag nopan"
        >
          {data?.bufferName && (
            <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:2 }}>
               <div style={{ width:6, height:6, borderRadius:'50%', background: bufferStats > 0 ? '#3b82f6' : '#cbd5e1' }} />
               <span style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing:'0.5px' }}>{data.bufferName}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {bufferStats !== null && (
               <>
                 <Droplets size={14} color="#3b82f6" fill={bufferStats > 0 ? "#3b82f6" : "none"} />
                 <span style={{ fontSize:'0.9rem' }}>{bufferStats.toFixed(1)} <small style={{ fontSize:'0.6rem' }}>m³</small></span>
               </>
            )}
            {!data?.bufferName && <span>{label}</span>}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const edgeTypes = {
  animated: AnimatedEdge,
};

/* ─── CUSTOM FLOW NODE ────────────────────────────────────────────────── */
const MachineNode = ({ data, selected }) => {
  const currentTime = useSimStore(s => s.currentTime);
  const eventTrace = useSimStore(s => s.eventTrace);
  const results = useSimStore(s => s.results);

  // Find the current state of this machine at the virtual time
  const activeEvents = useMemo(() => {
    if (!eventTrace) return [];
    const key = data.id;
    return eventTrace.filter(e => {
        if (e.t > currentTime) return false;
        if (!e.node) return false;
        if (e.node === key) return true;
        if (e.node.startsWith(key + "_")) {
            const suffix = e.node.substring(key.length + 1);
            return /^\d+$/.test(suffix);
        }
        return false;
    });
  }, [eventTrace, data.id, currentTime]);

  const lastEvent = activeEvents[activeEvents.length - 1];
  
  let status = 'IDLE';
  let isProcessing = false;
  let activeMat = null;

  if (lastEvent) {
    if (lastEvent.type === 'PROCESS_START') {
      status = 'PROCESSING';
      isProcessing = true;
      activeMat = lastEvent.mat;
    } else if (lastEvent.type === 'PROCESS_END') {
      status = 'IDLE';
    } else if (lastEvent.type === 'STATE') {
      status = lastEvent.data.state || 'IDLE';
      activeMat = lastEvent.mat;
      if (status === 'SETUP') isProcessing = true;
    }
  }

  // CALCULATE CURRENT QUEUE DEPTH
  const queueDepth = useMemo(() => {
    if (!eventTrace || eventTrace.length === 0) return 0;
    const key = data.id;
    
    let inQ = 0;
    for (const e of eventTrace) {
        if (e.t > currentTime) break;
        
        const target = e.data?.to;
        const node = e.node;

        const isTarget = target === key || (target?.startsWith(key + "_") && /^\d+$/.test(target.substring(key.length + 1)));
        const isNode = node === key || (node?.startsWith(key + "_") && /^\d+$/.test(node.substring(key.length + 1)));

        if (e.type === 'TRANSIT_END' && isTarget) inQ++;
        if (e.type === 'PROCESS_START' && isNode) inQ--;
    }
    return Math.max(0, inQ);
  }, [eventTrace, data.id, currentTime]);

  const nodeType = data.type || 'machine';
  const isTank = nodeType === 'tank';
  const isBuffer = nodeType === 'buffer';

  const statusColor = isTank ? '#3b82f6' : (isBuffer ? '#94a3b8' : (STATE_PALETTE[status] || '#94a3b8'));
  const jobColor = getJobColor(activeMat);
  const yieldColor = (data.yield_rate || 1.0) < 0.95 ? '#ef4444' : '#10b981';

  // Compact buffer style
  if (isBuffer) {
    return (
      <div className={`machine-card-node buffer-node ${selected ? 'selected' : ''}`} 
           style={{ width: 140, padding: 8, borderLeft: `4px solid ${statusColor}` }}>
        <Handle type="target" position={Position.Left} style={{ background: '#94a3b8' }} />
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <Zap size={12} color={statusColor}/>
            <span style={{ fontSize:'0.7rem', fontWeight:800, color:'#475569' }}>{data.label}</span>
        </div>
        <div style={{ fontSize:'0.55rem', color:'#94a3b8', marginTop:4 }}>Buffer Stage</div>
        <Handle type="source" position={Position.Right} style={{ background: '#94a3b8' }} />
      </div>
    );
  }

  return (
    <div 
      className={`machine-card-node ${selected ? 'selected' : ''}`} 
      style={{ 
        borderLeft: `5px solid ${isProcessing && activeMat ? jobColor : statusColor}`,
        boxShadow: isProcessing && activeMat ? `0 0 20px -3px ${jobColor}66` : (status === 'PROCESSING' ? `0 0 15px -3px ${statusColor}44` : ''),
        position: 'relative'
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (data.onEdit) data.onEdit();
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#3b82f6', width: 10, height: 10, border: '2px solid white' }} />
      
      {/* QUEUE / WIP INDICATOR (DOT STACK) */}
      {queueDepth > 0 && (
        <div style={{ position:'absolute', top:-18, left:0, width:'100%', display:'flex', gap:3, overflow:'hidden', padding:'0 5px' }}>
          {Array.from({ length: Math.min(15, queueDepth) }).map((_, i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:'50%', background:'#3b82f6', border:'1.5px solid white', boxShadow:'0 2px 4px rgba(0,0,0,0.1)' }} />
          ))}
          {queueDepth > 15 && <span style={{ fontSize:'0.65rem', fontWeight:800, color:'#3b82f6' }}>+{queueDepth-15}</span>}
        </div>
      )}

      {/* TIER 1: HEADER */}
      <div className="node-header" style={{ fontFamily: 'var(--font-display)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div className={`node-status-dot ${status === 'PROCESSING' ? 'pulse' : ''}`} style={{ background: statusColor }} />
          {isTank ? <LayoutDashboard size={14} color="#3b82f6" /> : <Cpu size={14} color={status === 'PROCESSING' ? statusColor : "#3b82f6"} />}
          <span style={{ fontSize:'0.8rem', fontWeight:700, color:'#0f172a' }}>{data.label}</span>
        </div>
        <div style={{ fontSize: '0.6rem', color: statusColor, fontWeight: 800, textTransform: 'uppercase' }}>{status}</div>
      </div>

      <div className="node-body">
        {/* TIER 2: PROCESS CORE */}
        <div className="node-process-box" style={{ borderColor: isProcessing ? `${jobColor}44` : '#e2e8f0', background: isProcessing ? `${jobColor}05` : '#f8fafc', justifyContent: 'center' }}>
          <div className="node-process-info" style={{ alignItems: 'center', width: '100%' }}>
            <span className="node-process-label" style={{ marginBottom: 4 }}>
              {isTank ? 'Vessel Storage Capacity' : (status === 'SETUP' ? 'Regenerating Resin' : 'Active Transformation')}
            </span>
            <span className="node-process-value">
              {isTank ? (
                <div style={{ width: '100%', height: 12, background: '#e2e8f0', borderRadius: 6, overflow: 'hidden', marginTop: 4 }}>
                  <div style={{ width: '60%', height: '100%', background: '#3b82f6' }} /> {/* Static for now, could be dynamic */}
                </div>
              ) : activeMat ? (
                <span className="job-label" style={{ background: jobColor }} title={activeMat}>{activeMat}</span>
              ) : (
                <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.7rem' }}>Standby...</span>
              )}
            </span>
          </div>
        </div>

        {/* TIER 3: METRICS FOOTER GRID */}
        <div className="node-metrics-grid">
          <div className="metric-unit">
            <div className="metric-unit-label">{isTank ? 'm3' : 'Cap'}</div>
            <div className="metric-unit-value">{isTank ? data.capacity : data.count}</div>
          </div>
          <div className="metric-unit">
            <div className="metric-unit-label">{isTank ? 'Press' : 'Setup'}</div>
            <div className="metric-unit-value">
              {isTank ? '2.4 bar' : `${((results?.machine_util?.[data.id]?.SETUP || 0) + (parseFloat(data.setup_time) || 0)).toFixed(1)}m`}
            </div>
          </div>
          <div className="metric-unit">
            <div className="metric-unit-label">Health</div>
            <div className="metric-unit-value" style={{ color: yieldColor }}>98%</div>
          </div>
        </div>
      </div>

      <div className="node-footer">
        <div className="node-footer-left">ID: {data.id}</div>
        <div className="node-footer-right">DM-PLANT v1.2</div>
      </div>
      
      <Handle type="source" position={Position.Right} style={{ background: '#3b82f6', width: 10, height: 10, border: '2px solid white' }} />
    </div>
  );
};

/* ─── FORMATTED TEXT (Bold Support) ────────────────────────────────── */
function FormattedText({ text }) {
  if (!text) return null;
  // This handles simple **bold** text without external dependencies
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i} style={{ fontWeight: 800 }}>{p.slice(2, -2)}</strong>;
        }
        return p;
      })}
    </>
  );
}

/* ─── SIDEBAR ──────────────────────────────────────────────────────────── */
function Sidebar({ setModalOpen, setSessionConfig, setResults, setSessionProblemName }) {
  const location = useLocation();
  const reset = useSimStore(s => s.reset);
  
  const handleHardRestart = () => {
    if (window.confirm("Restart everything and clear the current floor plan?")) {
        setSessionConfig(null);
        setResults(null);
        setSessionProblemName('');
        reset();
        window.location.href = '/';
    }
  };

  const isActive = (p) => location.pathname === p;
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <img src="/logo.png" alt="Logo" style={{ height: '28px', width: 'auto', marginRight: '0.75rem' }} />
      </div>
      <div className="nav-section-label" style={{ marginTop: '1.5rem' }}>Main Menu</div>
      <nav className="nav-menu">
        <Link to="/"            className={`nav-item ${isActive('/')            ? 'active':''}`}><LayoutDashboard size={16}/> Live Dashboard</Link>
        <Link to="/visual-line" className={`nav-item ${isActive('/visual-line') ? 'active':''}`}><Zap size={16}/>           Interactive Flow</Link>
        <Link to="/inventory"   className={`nav-item ${isActive('/inventory')   ? 'active':''}`}><Package size={16}/>        Inventory &amp; BOM</Link>
        <Link to="/orders"      className={`nav-item ${isActive('/orders')      ? 'active':''}`}><ClipboardList size={16}/>   Order Tracking</Link>
        <Link to="/utilization" className={`nav-item ${isActive('/utilization') ? 'active':''}`}><Cpu size={16}/>             Machine Utilization</Link>
        <Link to="/alerts"      className={`nav-item ${isActive('/alerts')      ? 'active':''}`}><Bell size={16}/>            Alerts</Link>
        <Link to="/logs"        className={`nav-item ${isActive('/logs')        ? 'active':''}`}><ScrollText size={16}/>      Raw Simulation Logs</Link>
      </nav>

      <div className="nav-section-label" style={{ marginTop: 'auto' }}>System Management</div>
      <button 
        onClick={() => setModalOpen(true)}
        className="nav-item" 
        style={{ width:'100%', background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'#64748b' }}
      >
        <Settings size={16}/> Simulation Settings
      </button>
      <button 
        onClick={handleHardRestart}
        className="nav-item" 
        style={{ width:'100%', background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'#ef4444', fontWeight:600 }}
      >
        <RotateCcw size={16}/> RESET FACTORY
      </button>
    </div>
  );
}

function AIChatPanel({ chatHistory, setChatHistory, askAI, results, setIsChatCollapsed }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory]);

  const send = () => {
    if (!input.trim()) return;
    askAI(input);
    setInput('');
  };

  const suggestions = [
    'What is the biggest bottleneck?',
    'How can I increase throughput?',
    'Propose a configuration change to reduce wait time.'
  ];

  return (
    <div className="ai-right-panel">
      <div className="ai-right-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
          <div className="ai-sparkle">✨</div>
          <div style={{ fontWeight:700, fontSize:'0.9rem' }}>AI Operations Assistant</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setChatHistory([{ role: 'assistant', content: 'History cleared. How can I help?' }])} 
                  className="clear-btn" title="Clear History">
            <RotateCcw size={14}/>
          </button>
          <button onClick={() => setIsChatCollapsed(true)} className="collapse-btn" title="Collapse Panel">
            <ChevronRight size={16}/>
          </button>
        </div>
      </div>
      
      <div className="ai-right-messages">
        {chatHistory.length === 0 ? (
          <div className="ai-empty-state">
            <Bot size={36} color="#334155" />
            <p>Run a simulation to start a conversation.</p>
          </div>
        ) : (
          chatHistory.map((m, i) => (
            <div key={i} className={`ai-msg-row ${m.role}`}>
              <div className={`ai-bubble ${m.role}`}>
                <div style={{ fontSize:'0.65rem', fontWeight:800, opacity:0.6, marginBottom:2, textTransform:'uppercase' }}>
                  {m.role === 'assistant' ? 'AI ANALYST' : 'YOU'}
                </div>
                {m.whatIf ? <WhatIfBubble data={m.whatIf}/> : <FormattedText text={m.content}/>}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {results && chatHistory.length > 0 && (
        <div className="ai-suggestions-bar">
          {suggestions.map((s,i) => (
            <button key={i} className="ai-suggestion-btn" onClick={() => askAI(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="ai-right-input">
        <input 
          className="ai-input"
          placeholder="Ask AI about bottlenecks..."
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e => { if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }}}
        />
        <button onClick={send} className="ai-send-btn" disabled={!input.trim()}><Send size={16}/></button>
      </div>
    </div>
  );
}

/* ─── LIVE DASHBOARD ───────────────────────────────────────────────────── */
function LiveDashboard({ results, sessionConfig, sessionProblemName, setModalOpen }) {
  const [hiddenKeys, setHiddenKeys] = useState(new Set());
  const [focusBuffer, setFocusBuffer] = useState('ALL');
  
  const { chartData, lineKeys } = useMemo(() => {
    if (!results?.sample_queue_trace) return { chartData: [], lineKeys: [] };
    const keys = Object.keys(results.sample_queue_trace);
    if (keys.length === 0) return { chartData: [], lineKeys: [] };

    const labels = {};
    keys.forEach(k => {
      const m = k.match(/\(([^)]+)\)$/);
      labels[k] = m ? m[1] : (k.length > 22 ? k.slice(0,19)+'…' : k);
    });

    const withPeak = keys.map(k => {
      const traces = results.sample_queue_trace[k] || [];
      return {
        key: k,
        peak: traces.length > 0 ? Math.max(...traces.map(p => p?.count || 0)) : 0
      };
    }).sort((a,b)=>b.peak-a.peak).slice(0,8);
    const topKeys = withPeak.map(x=>x.key);

    const firstKey = keys[0];
    const totalPoints = results.sample_queue_trace[firstKey]?.length || 0;
    const maxGraphPoints = 80;
    const step = Math.max(1, Math.floor(totalPoints / maxGraphPoints));

    const data = [];
    for (let i = 0; i < totalPoints; i += step) {
      const snapshot = results.sample_queue_trace[firstKey][i];
      if (!snapshot) continue;
      const pt = { time: Math.round(snapshot.t || 0) };
      topKeys.forEach(k => {
        const val = (results.sample_queue_trace[k] && results.sample_queue_trace[k][i]) ? results.sample_queue_trace[k][i].count : 0;
        pt[labels[k]] = val;
      });
      data.push(pt);
    }
    return { chartData: data, lineKeys: topKeys.map(k => labels[k]) };
  }, [results]);

  const leaderboard = useMemo(() => {
    if (!results?.sample_queue_trace) return [];
    
    const machineAggregates = {};
    
    Object.entries(results.sample_queue_trace).forEach(([key, snaps]) => {
      // Robust machine name identification
      let machineName = 'Unknown';
      if (key.includes('→')) {
        const arrowMatch = key.match(/→([^(]+)/);
        machineName = arrowMatch ? arrowMatch[1].trim() : key;
      } else {
        machineName = key.split('(')[0].trim();
      }
      
      if (!machineAggregates[machineName]) {
        machineAggregates[machineName] = new Array(snaps.length).fill(0);
      }
      
      snaps.forEach((s, idx) => {
        if (idx < machineAggregates[machineName].length) {
          machineAggregates[machineName][idx] += (s?.count || 0);
        }
      });
    });

    return Object.entries(machineAggregates).map(([machineName, counts]) => {
      const total = counts.reduce((s, c) => s + c, 0);
      const avgValue = total / Math.max(1, counts.length);
      const peak = Math.max(...counts);
      
      const avgStr = avgValue < 0.1 ? avgValue.toFixed(3) : avgValue < 1 ? avgValue.toFixed(2) : avgValue.toFixed(1);
      
      return { label: machineName, avgValue, avg: avgStr, peak };
    }).sort((a, b) => b.avgValue - a.avgValue);
  }, [results]);

  const machineStateData = useMemo(() => {
    if (!results?.machine_util) return [];
    const totals = { Processing:0, Setup:0, Starved:0, Idle:0, Down:0 };
    Object.values(results.machine_util).forEach(s => {
      totals.Processing += s['PROCESSING']||0;
      totals.Setup      += s['SETUP']||0;
      totals.Starved    += s['STARVED']||0;
      totals.Idle       += s['IDLE']||0;
      totals.Down       += s['DOWN']||0;
    });
    const total = totals.Processing + totals.Setup + totals.Starved + totals.Idle + totals.Down || 1;
    return [
      { name:'Active/Processing', value: Math.round((totals.Processing/total)*100) },
      { name:'Setup/Cleaning',    value: Math.round((totals.Setup/total)*100) },
      { name:'Starved/Waiting',   value: Math.round((totals.Starved/total)*100) },
      { name:'Mechanical Repair', value: Math.round((totals.Down/total)*100) },
      { name:'Idle State',        value: Math.round((totals.Idle/total)*100) },
    ];
  }, [results]);
  const PIE = [STATE_PALETTE.Processing, STATE_PALETTE.Setup, STATE_PALETTE.Waiting, STATE_PALETTE.Down, STATE_PALETTE.Idle];
  const dominant = machineStateData[0];

  const completedItems = results?.completed_items || [];
  const totalTreated = useMemo(() => {
    if (!completedItems.length) return results?.average_throughput || 0;
    return completedItems.reduce((acc, item) => acc + (item.volume || 0), 0);
  }, [completedItems, results]);

  const avgCycle = completedItems.length
    ? (completedItems.reduce((s,i)=>s+(i.cycle_time||0),0)/completedItems.length).toFixed(1) : null;

  return (
    <div className="main-content">
      <div className="page-header">
        <div className="page-header-left">
          <h2>Live Dashboard {results && <span className="header-sub">| Run Complete</span>}</h2>
          <div className="page-subtitle">Real-time production monitoring & analytics</div>
        </div>
        {!results && sessionConfig && (
          <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', padding:'0.5rem 1rem', borderRadius:10, display:'flex', alignItems:'center', gap:'0.75rem' }}>
            <div style={{ fontSize:'0.75rem', color:'#1e40af', fontWeight:600 }}>
              <Package size={14} style={{ verticalAlign:'middle', marginRight:4 }}/>
              Configuration Loaded: <strong>{sessionProblemName || "Factory Layout Ready"}</strong>
            </div>
            <button className="btn-primary" onClick={() => setModalOpen(true)} style={{ margin:0, padding:'4px 12px', fontSize:'0.75rem' }}>Open Settings</button>
          </div>
        )}
      </div>

      <div className="kpi-row">
        {[
          { label:'Total Water Treated',  sub:'cumulative flow', val: totalTreated.toFixed(1), unit:'m3' },
          { label:'Quality Violations',   sub:'conductivity threshold', val: (results?.quality_violations || 0).toFixed(0), unit:'events' },
          { label:'Sim Runs Completed',   sub:'Statistical iterations', val: results?.runs, unit:'runs' },
          { label:'Avg Downtime / Mach', sub:'average lost minutes per shift', val: (results?.average_downtime || 0).toFixed(1), unit:'mins' },
        ].map((k,i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-sublabel">{k.sub}</div>
            <div className="kpi-value">{k.val??'—'}<span>{k.unit}</span></div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:'1.25rem' }}>
        <div className="chart-card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <div>
              <div className="chart-title">Line Congestion Analytics</div>
              <div className="chart-subtitle">WIP per machine / buffer over time</div>
            </div>
            <select 
              value={focusBuffer} 
              onChange={(e) => setFocusBuffer(e.target.value)}
              style={{ padding:'6px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, fontWeight:600, color:'#1e293b', background:'#f8fafc' }}
            >
              <option value="ALL">Show Combined View</option>
              {lineKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          
          <div style={{ height:280 }}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top:20, right:30, left:20, bottom:10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="time" tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false}/>
                  <Tooltip 
                    isAnimationActive={false}
                    cursor={{ stroke: '#64748b', strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:8, boxShadow:'0 4px 12px rgba(0,0,0,0.1)', padding:'10px' }}>
                            <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', borderBottom:'1px solid #f1f5f9', marginBottom:8, paddingBottom:4 }}>
                               TIME: {label}m
                            </div>
                            {payload.map((p, i) => (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:'15px', fontSize:13, color:p.color, marginBottom:4 }}>
                                <span style={{ fontWeight:800 }}>{p.name}:</span>
                                <span style={{ fontWeight:900, fontFamily:'monospace', marginLeft:'auto' }}>{Number(p.value).toFixed(1)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  {lineKeys.filter(k => focusBuffer === 'ALL' ? !hiddenKeys.has(k) : k === focusBuffer).map((k,i) => (
                    <Line 
                      key={k} 
                      type="monotone" 
                      dataKey={k} 
                      stroke={CHART_COLORS[lineKeys.indexOf(k)%CHART_COLORS.length]}
                      strokeWidth={3} 
                      dot={false} 
                      activeDot={{ r:5 }} 
                      connectNulls 
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><Play size={28} color="#e2e8f0"/><p>Run simulation to view queue graph</p></div>
            )}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Machine State Distribution</div>
          <div className="chart-subtitle">Aggregate across all machines</div>
          <div style={{ height:200, position:'relative' }}>
            {machineStateData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={machineStateData} cx="45%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={3} dataKey="value">
                    {machineStateData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{ fontSize:12, borderRadius:8 }}/>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><p>No data</p></div>
            )}
            {dominant && (
              <div style={{ position:'absolute', top:'50%', left:'45%', transform:'translate(-50%,-50%)', textAlign:'center', pointerEvents:'none' }}>
                <div style={{ fontSize:'1.2rem', fontWeight:700, color:'#1e293b' }}>{dominant.value}%</div>
                <div style={{ fontSize:'0.65rem', color:'#94a3b8' }}>{dominant.name}</div>
              </div>
            )}
          </div>
          {machineStateData.length > 0 && (
            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'center', marginTop:'0.5rem', flexWrap:'wrap', padding:'0 0.5rem' }}>
              {machineStateData.map((d,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.3rem', fontSize:'0.68rem', color:'#64748b', whiteSpace:'nowrap' }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:PIE_COLORS[i % PIE_COLORS.length] }}/> {d.name === 'Active/Processing' ? 'Active' : d.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {leaderboard.length > 0 && (
        <div className="chart-card" style={{ marginTop:'1.25rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem' }}>
            <Trophy size={17} color="#f59e0b"/><div className="chart-title">WIP Leaderboard</div>
          </div>
          <div className="chart-subtitle">Machines ranked by aggregate queue contribution</div>
          <table>
            <thead><tr><th>#</th><th>Buffer / Machine</th><th>Avg WIP</th><th>Peak</th><th>Status</th></tr></thead>
            <tbody>
              {leaderboard.map((r,i) => {
                const pct = Math.min(100, Math.round((r.peak/(leaderboard[0].peak||1))*100));
                // Use absolute peak thresholds for status — relative % alone is misleading
                const level = r.peak > 10
                  ? {t:'Critical', c:'badge-red'}
                  : r.peak > 4
                  ? {t:'High',     c:'badge-yellow'}
                  : {t:'Normal',   c:'badge-green'};
                return (
                  <tr key={i}>
                    <td style={{ fontWeight:700, color: i<3?'#f59e0b':'#94a3b8' }}>
                      {i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}
                    </td>
                    <td style={{ fontWeight:600, fontSize:'0.82rem' }}>{r.label}</td>
                    <td>{r.avg}</td>
                    <td><strong>{r.peak}</strong></td>
                    <td><span className={level.c}>{level.t}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── INVENTORY & PRODUCT BLUEPRINT MANAGER ────────────────────────── */
function InventoryManager({ sessionConfig, setSessionConfig }) {
  const [newMaterial, setNewMaterial] = useState('');
  const [newRate, setNewRate] = useState(10);
  
  // Normalize material_types to objects for consistency
  const mList = (sessionConfig?.material_types || []).map(m => typeof m === 'string' ? { name: m, arrival_rate: 10 } : m);
  const pBlueprints = sessionConfig?.product_blueprints || [];
  const nodes = sessionConfig?.nodes || [];

  const addMat = () => {
    if (!newMaterial) return;
    setSessionConfig(p => {
      const prev = p || {};
      const exists = (prev.material_types || []).some(m => (m.name || m) === newMaterial);
      if (exists) return prev;
      return { 
        ...prev, 
        material_types: [...(prev.material_types || []), { name: newMaterial, arrival_rate: newRate }] 
      };
    });
    setNewMaterial('');
  };

  const updateMatRate = (idx, rate) => {
    setSessionConfig(p => {
      const next = [...(p.material_types || [])];
      if (typeof next[idx] === 'string') next[idx] = { name: next[idx], arrival_rate: rate };
      else next[idx] = { ...next[idx], arrival_rate: rate };
      return { ...p, material_types: next };
    });
  };

  const addBlueprint = () => {
    setSessionConfig(p => {
      const prev = p || { product_blueprints: [] };
      return {
        ...prev,
        product_blueprints: [
          ...(prev.product_blueprints || []), 
          { name: `Blueprint_${(prev.product_blueprints?.length || 0) + 1}`, materials: [], path: [] }
        ]
      };
    });
  };

  const updateBlueprint = (idx, field, val) => {
    setSessionConfig(p => {
      const prev = p || {};
      const next = [...(prev.product_blueprints || [])];
      next[idx] = { ...next[idx], [field]: val };
      return { ...prev, product_blueprints: next };
    });
  };

  const reorderPath = (bpIdx, stepIdx, direction) => {
    const nextPath = [...(pBlueprints[bpIdx].path || [])];
    const targetIdx = stepIdx + direction;
    if (targetIdx < 0 || targetIdx >= nextPath.length) return;
    [nextPath[stepIdx], nextPath[targetIdx]] = [nextPath[targetIdx], nextPath[stepIdx]];
    updateBlueprint(bpIdx, 'path', nextPath);
  };

  const addMaterialToBP = (bpIdx) => {
    setSessionConfig(p => {
      const prev = p || {};
      const next = [...(prev.product_blueprints || [])];
      const defaultMat = (mList[0]?.name || 'Standard');
      const materials = [...(next[bpIdx].materials || []), { material: defaultMat, qty: 1 }];
      next[bpIdx] = { ...next[bpIdx], materials };
      return { ...prev, product_blueprints: next };
    });
  };

  const addMachineToPath = (bpIdx, machineName) => {
    if (!machineName) return;
    setSessionConfig(p => {
      const prev = p || {};
      const next = [...(prev.product_blueprints || [])];
      const path = [...(next[bpIdx].path || []), machineName];
      next[bpIdx] = { ...next[bpIdx], path };
      return { ...prev, product_blueprints: next };
    });
  };

  const removeBlueprint = (idx) => {
    setSessionConfig(p => ({ ...p, product_blueprints: (p.product_blueprints || []).filter((_, i) => i !== idx) }));
  };

  return (
    <div className="main-content">
      <div className="page-header">
        <div>
          <h2>Product Blueprint Architect</h2>
          <div className="page-subtitle">Define DNA, specific per-material arrival rates, and production paths</div>
        </div>
        <button onClick={addBlueprint} className="btn-primary" style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
          <Package size={18}/> Create New Blueprint
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:'2rem' }}>
        {/* Materials List */}
        <div className="card" style={{ padding:'1.5rem', height:'fit-content' }}>
          <h3 style={{ fontSize:'0.9rem', marginBottom:'1rem' }}>Global Material Ledgers</h3>
          <div className="page-subtitle" style={{ marginBottom:'0.5rem', fontSize:'0.75rem' }}>Define arrival frequency (Units/Hr)</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.5rem' }}>
            <input value={newMaterial} onChange={e=>setNewMaterial(e.target.value)} placeholder="Material name..."
                   style={{ padding:'0.5rem', border:'1px solid #e2e8f0', borderRadius:6, fontSize:'0.85rem' }} />
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <input type="number" value={newRate} onChange={e=>setNewRate(parseInt(e.target.value)||0)} placeholder="Rate..."
                     style={{ flex:1, padding:'0.5rem', border:'1px solid #e2e8f0', borderRadius:6, fontSize:'0.85rem' }} />
              <button onClick={addMat} className="btn-primary" style={{ padding:'0.5rem' }}><Plus size={16}/></button>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
            {mList.map((m,i) => (
              <div key={i} className="li-item" style={{ display:'flex', flexDirection:'column', padding:'0.85rem', background:'#f8fafc', borderRadius:8, fontSize:'0.85rem', border:'1px solid #f1f5f9' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                  <span style={{ fontWeight:800, color:'#1e293b' }}>{m.name || m}</span>
                  <Trash2 size={13} color="#94a3b8" style={{ cursor:'pointer' }} 
                          onClick={()=>setSessionConfig(p=>({...p, material_types: p.material_types.filter((_,idx)=>idx!==i)}))}/>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                  <span style={{ fontSize:'0.7rem', color:'#64748b' }}>Rate / Hr:</span>
                  <input 
                    type="number" 
                    value={m.arrival_rate || 0} 
                    onChange={e => updateMatRate(i, parseInt(e.target.value)||0)}
                    style={{ flex:1, padding:'2px 6px', border:'1px solid #e2e8f0', borderRadius:4, fontSize:'0.8rem', fontWeight:600 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Blueprint List */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
          {pBlueprints.map((bp, bpIdx) => (
            <div key={bpIdx} className="card" style={{ overflow:'hidden', borderLeft:'5px solid #3b82f6' }}>
              <div style={{ background:'#f8fafc', padding:'1rem 1.5rem', borderBottom:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <input 
                  value={bp.name} 
                  onChange={e => updateBlueprint(bpIdx, 'name', e.target.value)}
                  style={{ background:'transparent', border:'none', fontSize:'1.1rem', fontWeight:800, color:'#1e293b', padding:0 }}
                />
                <button onClick={() => removeBlueprint(bpIdx)} style={{ color:'#ef4444', border:'none', background:'none', cursor:'pointer' }}><Trash2 size={18}/></button>
              </div>

              <div style={{ padding:'1.5rem' }}>
                {/* Section A: Materials Required */}
                <div style={{ maxWidth: 450 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                    <h4 style={{ fontSize:'0.75rem', fontWeight:800, color:'#64748b', textTransform:'uppercase' }}>End Product Composition (DNA)</h4>
                    <button onClick={() => addMaterialToBP(bpIdx)} style={{ fontSize:'0.7rem', color:'#3b82f6', border:'none', background:'none', fontWeight:700, cursor:'pointer' }}>+ Add Ingredient</button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
                    {(bp.materials || []).map((m, mIdx) => (
                      <div key={mIdx} style={{ display:'flex', gap:'0.5rem', background: '#f8fafc', padding: '0.6rem', borderRadius: 10, border: '1px solid #f1f5f9' }}>
                        <select 
                          value={m.material} 
                          onChange={e => {
                            const mats = [...bp.materials];
                            mats[mIdx].material = e.target.value;
                            updateBlueprint(bpIdx, 'materials', mats);
                          }}
                          style={{ flex:1, padding:'0.4rem', borderRadius:6, border:'1px solid #e2e8f0', fontSize:'0.85rem', fontWeight: 600 }}
                        >
                          {mList.map(mat => (
                            <option key={mat.name || mat} value={mat.name || mat}>{mat.name || mat}</option>
                          ))}
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Qty:</span>
                          <input 
                            type="number" 
                            value={m.qty} 
                            onChange={e => {
                              const mats = [...bp.materials];
                              mats[mIdx].qty = parseInt(e.target.value) || 1;
                              updateBlueprint(bpIdx, 'materials', mats);
                            }}
                            style={{ width:60, padding:'0.4rem', borderRadius:6, border:'1px solid #e2e8f0', fontSize:'0.85rem', fontWeight: 700, textAlign: 'center' }}
                          />
                          <button onClick={() => {
                            const mats = bp.materials.filter((_, i) => i !== mIdx);
                            updateBlueprint(bpIdx, 'materials', mats);
                          }} style={{ color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', padding: '0 5px' }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {pBlueprints.length === 0 && (
            <div style={{ padding:'5rem', textAlign:'center', background:'#f8fafc', borderRadius:16, border:'2px dashed #e2e8f0', color:'#94a3b8' }}>
              <Package size={48} style={{ opacity:0.3, marginBottom:'1rem' }} />
              <h3>No Product Blueprints Defined</h3>
              <p>Create a blueprint to define material quantities and the specific path items must follow.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
/* ─── ORDER TRACKING ───────────────────────────────────────────────────── */
function OrdersPage({ results, sessionConfig }) {
  const items = results?.completed_items || [];
  
  // Helper to extract clean product name from complex material strings
  const getCleanProduct = (mat) => {
    if (!mat || typeof mat !== 'string') return 'Unknown';
    // If we have demand config, try to exact match first
    const demandNames = sessionConfig?.demand?.map(d => d.Final_Product_To_Build) || [];
    for (let name of demandNames) {
      if (name && mat.toLowerCase().includes(name.toLowerCase())) return name;
    }
    // Fallback: take the first part of the snake_case string (usually the brand/SKU)
    const parts = mat.split('_');
    return parts[0] || 'Standard';
  };

  // Dynamic Histogram for Completion Rhythm
  const throughputData = useMemo(() => {
    if (!items.length || !results?.sim_time) return [];
    const runTime = results.sim_time;
    const binCount = 20;
    const binWidth = runTime / binCount;
    const bins = Array.from({ length: binCount }, (_, i) => ({
      time: Math.round((i + 1) * binWidth),
      count: 0,
      label: `${Math.round(i * binWidth)}-${Math.round((i + 1) * binWidth)}m`
    }));
    
    items.forEach(item => {
      const idx = Math.min(binCount - 1, Math.floor((item.time_done || 0) / binWidth));
      if (idx >= 0) bins[idx].count++;
    });
    return bins;
  }, [items, results]);

  const distData = useMemo(() => {
    if (!items.length) return [];
    const maxCT = Math.max(...items.map(i => i.cycle_time || 0));
    const binCount = 5;
    const binWidth = Math.ceil(maxCT / binCount) || 20;
    const b = {};
    for (let i = 0; i < binCount; i++) {
        const key = `${i * binWidth}-${(i + 1) * binWidth}m`;
        b[key] = 0;
    }
    items.forEach(i => {
      const ct = i.cycle_time || 0;
      const idx = Math.min(binCount - 1, Math.floor(ct / binWidth));
      const key = `${idx * binWidth}-${(idx + 1) * binWidth}m`;
      b[key] = (b[key] || 0) + 1;
    });
    return Object.entries(b).map(([k,v])=>({range:k,count:v}));
  }, [items]);

  const productSummary = useMemo(() => {
    const finalProductTypes = new Set((sessionConfig?.demand || []).map(d => d.product));
    
    if (!results?.average_product_counts) {
      if (!items.length) return [];
      const c = {};
      items.forEach(i => { 
        if (!finalProductTypes.has(i.material)) return;
        const mat = getCleanProduct(i.material);
        c[mat] = (c[mat] || 0) + 1; 
      });
      return Object.entries(c)
        .map(([mat, count]) => ({ mat, count }))
        .sort((a, b) => b.count - a.count);
    }

    const c = {};
    Object.entries(results.average_product_counts).forEach(([rawMat, avgCount]) => {
      // Filter only for products that appear in demand list (end products)
      if (!finalProductTypes.has(rawMat)) return;
      const mat = getCleanProduct(rawMat);
      c[mat] = (c[mat] || 0) + avgCount;
    });
    return Object.entries(c)
      .map(([mat, count]) => ({ mat, count }))
      .sort((a, b) => b.count - a.count);
  }, [results, items, sessionConfig]);

  return (
    <div className="main-content">
      <div className="page-header">
        <div className="page-header-left">
          <h2>Order Tracking &amp; Exact Traceability</h2>
          <div className="page-subtitle">Cycle-time distributions, product counts, and BOM lineage</div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.25rem' }}>
        <div className="chart-card" style={{ height:240 }}>
          <div className="chart-title">Cycle Time Distribution</div>
          <div className="chart-subtitle">Frequency of job completion lead times</div>
          {distData.length>0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distData} margin={{ top:5, right:20, left:-20, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <XAxis dataKey="range" tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12 }}/>
                <Bar dataKey="count" name="Orders" fill="#3b82f6" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state"><p>Run simulation to see distribution</p></div>}
        </div>

        <div className="chart-card" style={{ height:240 }}>
          <div className="chart-title">Production Rhythm (Throughput)</div>
          <div className="chart-subtitle">Units completed over simulation time (Dynamic Bins)</div>
          {throughputData.length>0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={throughputData} margin={{ top:5, right:20, left:-20, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <XAxis dataKey="time" tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} unit="m"/>
                <YAxis tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false}/>
                <Tooltip labelFormatter={v=>`Time: ${v} min`} contentStyle={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12 }}/>
                <Bar dataKey="count" name="Finished Units" fill="#10b981" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state"><p>Run simulation to view throughput rhythm</p></div>}
        </div>
      </div>
      {productSummary.length>0 && (
        <div className="chart-card">
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem' }}>
            <Package size={17} color="#3b82f6"/><div className="chart-title">Final Product Count Summary</div>
          </div>
          <div className="chart-subtitle">Total units completed per product type</div>
          <table>
            <thead><tr><th>Product / Material</th><th>Units Completed</th><th>Share</th><th>Volume</th></tr></thead>
            <tbody>
              {productSummary.map((item,i) => {
                const pct = Math.round((item.count/items.length)*100);
                return (
                  <tr key={i}>
                    <td><span className="mode-badge-navy">{item.mat}</span></td>
                    <td style={{ fontWeight:700, color:'#1e293b' }}>{item.count.toFixed(1)}</td>
                    <td>{Math.round((item.count / (results?.average_throughput || 1)) * 100)}%</td>
                    <td>
                      <div style={{ width:'100%', background:'#f1f5f9', borderRadius:4, height:7, overflow:'hidden', minWidth:120 }}>
                        <div style={{ width:`${pct}%`, background:CHART_COLORS[i%CHART_COLORS.length], height:'100%', borderRadius:4 }}/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {items.length>0 && (
        <div className="chart-card" style={{ overflowX:'auto' }}>
          <div className="chart-title" style={{ marginBottom:'1rem' }}>Completed Orders (last 60)</div>
          <table>
            <thead><tr><th>Product ID</th><th>Material</th><th>Cycle Time</th><th>Status</th><th>BOM Lineage</th></tr></thead>
            <tbody>
              {items.slice(-60).reverse().map((item,i) => (
                <tr key={i}>
                  <td style={{ fontWeight:600, color:'#3b82f6', fontFamily:'monospace', fontSize:'0.8rem' }}>
                    {(item.id || '').split('_').pop() || 'N/A'}
                  </td>
                  <td><span className="mode-badge-navy">{getCleanProduct(item.material)}</span></td>
                  <td>{(item.cycle_time||0).toFixed(1)} min</td>
                  <td><span className="badge-green">✓ Complete</span></td>
                  <td style={{ color:'#94a3b8', fontSize:'0.78rem' }}>{item.components?.map(c=>c.id).join(', ')||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── MACHINE UTILIZATION ──────────────────────────────────────────────── */
function UtilizationPage({ results }) {
  const { pctData, minData } = useMemo(() => {
    if (!results?.machine_util) return { pctData:[], minData:[] };
    const rows = Object.entries(results.machine_util).map(([id,s]) => ({
      name: id.replace(/_\d+$/, ''),
      Processing: s['PROCESSING']||0, 
      Setup: s['SETUP']||0, 
      Starved: s['STARVED']||0,
      Idle: s['IDLE']||0,
      Down: s['DOWN']||0
    }));
    const pct = rows.map(r => {
      const t = r.Processing + r.Setup + r.Starved + r.Idle + r.Down || 1;
      return { 
        name: r.name, 
        'Active Processing': +((r.Processing/t)*100).toFixed(1), 
        'Product Setup': +((r.Setup/t)*100).toFixed(1), 
        'Waiting (Starved)': +((r.Starved/t)*100).toFixed(1),
        'Mechanical Repair': +((r.Down/t)*100).toFixed(1),
        'Idle/Other': +((r.Idle/t)*100).toFixed(1)
      };
    });
    const mins = rows.map(r => ({ 
      name: r.name, 
      'Active Processing': Math.round(r.Processing), 
      'Product Setup': Math.round(r.Setup), 
      'Waiting (Starved)': Math.round(r.Starved),
      'Mechanical Repair': Math.round(r.Down),
      'Idle/Other': Math.round(r.Idle)
    }));
    return { pctData:pct, minData:mins };
  }, [results]);
  const h = Math.max(280, (pctData.length*44)+60);
  const SharedBar = ({ data, unit }) => (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top:5, right:30, left:10, bottom:10 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9"/>
        <XAxis type="number" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false}
          tickFormatter={v=>unit==='%'?`${v}%`:`${v}m`} domain={unit==='%'?[0,100]:undefined}/>
        <YAxis dataKey="name" type="category" width={180} tick={{ fontSize:10, fill:'#374151' }} axisLine={false} tickLine={false}/>
        <Tooltip formatter={(v,n)=>[`${v}${unit==='%'?'%':' min'}`,n]} contentStyle={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12 }}/>
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize:12 }}/>
        <Bar key="Active Processing" dataKey="Active Processing" stackId="a" fill={STATE_PALETTE['PROCESSING']} />
        <Bar key="Product Setup"    dataKey="Product Setup"    stackId="a" fill={STATE_PALETTE['SETUP']} />
        <Bar key="Waiting (Starved)" dataKey="Waiting (Starved)" stackId="a" fill={STATE_PALETTE['STARVED'] || STATE_PALETTE['WAITING']} />
        <Bar key="Mechanical Repair" dataKey="Mechanical Repair" stackId="a" fill={STATE_PALETTE['DOWN']} />
        <Bar key="Idle/Other"        dataKey="Idle/Other"        stackId="a" fill={STATE_PALETTE['IDLE']} radius={[0,4,4,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
  return (
    <div className="main-content">
      <div className="page-header">
        <div className="page-header-left"><h2>Machine Activity</h2><div className="page-subtitle">What the machines were doing throughout the simulation</div></div>
      </div>
      <div className="chart-card">
        <div className="chart-title">Machine Status (%)</div>
        <div className="chart-subtitle">Percentage of time in each state</div>
        {pctData.length>0 ? <SharedBar data={pctData} unit="%"/> : <div className="empty-state"><p>Run simulation</p></div>}
      </div>
      <div className="chart-card">
        <div className="chart-title">Total Time (minutes)</div>
        <div className="chart-subtitle">Absolute minutes in each state</div>
        {minData.length>0 ? <SharedBar data={minData} unit="min"/> : <div className="empty-state"><p>No data</p></div>}
      </div>
    </div>
  );
}

/* ─── ALERTS ───────────────────────────────────────────────────────────── */
function AlertsPage({ results }) {
  const alerts = useMemo(() => {
    const out = [];
    if (!results) return out;
    const { machine_util, sample_queue_trace, average_throughput, raw_logs } = results;
    if (machine_util) {
      const rows = Object.entries(machine_util).map(([id,s]) => {
        const t = (s.PROCESSING||0)+(s.IDLE||0)+(s.STARVED||0)||1;
        return { id, procPct:((s.PROCESSING||0)/t)*100, starvedPct:((s.STARVED||0)/t)*100 };
      });
      const sorted = [...rows].sort((a,b)=>b.procPct-a.procPct);
      if (sorted[0]?.procPct>75) out.push({ type:'bottleneck', severity:'critical', title:`Bottleneck: ${sorted[0].id}`, detail:`Active ${sorted[0].procPct.toFixed(1)}% of runtime — primary production constraint. Add parallel capacity.` });
      rows.filter(r=>r.starvedPct>30).forEach(r => out.push({ type:'starvation', severity:r.starvedPct>60?'critical':'warning', title:`Starvation: ${r.id} (${r.starvedPct.toFixed(1)}% idle)`, detail:`Machine is waiting for input material ${r.starvedPct.toFixed(0)}% of its runtime. Check upstream feed rate.` }));
      rows.filter(r=>r.procPct<20).forEach(r => out.push({ type:'underutil', severity:'info', title:`Underutilised: ${r.id}`, detail:`Only ${r.procPct.toFixed(1)}% productive. May be over-provisioned or blocked.` }));
    }
    if (sample_queue_trace) {
      Object.entries(sample_queue_trace).forEach(([buf, snaps]) => {
        const label = buf.match(/\(([^)]+)\)$/)?.[1]||buf;
        const peak = Math.max(...snaps.map(p=>p?.count||0));
        if (peak>20) out.push({ type:'wip', severity:peak>50?'critical':'warning', title:`High WIP: ${label}`, detail:`Peak ${peak} units queued. Upstream–downstream imbalance. Consider batch size reduction.` });
      });
    }
    const scrap = (raw_logs||[]).filter(m=>m.includes('Scrap')||m.includes('Yield Loss'));
    if (scrap.length>0) out.push({ type:'yield', severity:scrap.length>15?'critical':'warning', title:`Yield Issues: ${scrap.length} parts lost`, detail:`${scrap.length} batches were scrapped due to process yield failure. This reduces effective capacity.` });
    
    const rework = (raw_logs||[]).filter(m=>m.includes('Rework')||m.includes('fail'));
    if (rework.length>0) out.push({ type:'quality', severity:rework.length>10?'critical':'warning', title:`Quality Issues: ${rework.length} rework events`, detail:`${rework.length} parts rerouted to rework. Adds cycle time and reduces effective throughput.` });
    if (average_throughput<10&&average_throughput>0) out.push({ type:'throughput', severity:'warning', title:`Low Throughput: ${average_throughput.toFixed(1)} units/run`, detail:`Below 10 units per run. Review demand rates, machine counts and routing probabilities.` });
    return out;
  }, [results]);
  const cfg = { critical:{ border:'#ef4444', bg:'#fef2f2', cls:'badge-red',    icon:<AlertTriangle size={16} color="#ef4444"/> },
                warning: { border:'#f59e0b', bg:'#fffbeb', cls:'badge-yellow', icon:<AlertTriangle size={16} color="#f59e0b"/> },
                info:    { border:'#3b82f6', bg:'#eff6ff', cls:'mode-badge',   icon:<CheckCircle2  size={16} color="#3b82f6"/> } };
  const typeLabel = { bottleneck:'Bottleneck', starvation:'Starvation', underutil:'Underutilised', wip:'High WIP', quality:'Quality', throughput:'Throughput' };
  return (
    <div className="main-content">
      <div className="page-header">
        <div className="page-header-left"><h2>Factory Alerts</h2><div className="page-subtitle">Auto-generated operational insights from simulation results</div></div>
        {alerts.length>0 && <span className="badge-red">{alerts.filter(a=>a.severity==='critical').length} Critical · {alerts.length} Total</span>}
      </div>
      {!results ? (
        <div className="chart-card"><div className="empty-state"><Play size={32} color="#e2e8f0"/><p>Run a simulation to generate alerts</p></div></div>
      ) : alerts.length===0 ? (
        <div className="chart-card"><div style={{ padding:'2rem', textAlign:'center', color:'#10b981', display:'flex', flexDirection:'column', alignItems:'center', gap:'0.75rem' }}>
          <CheckCircle2 size={40}/><div style={{ fontWeight:600 }}>All Systems Normal</div>
          <div style={{ fontSize:'0.85rem', color:'#94a3b8' }}>No bottlenecks, starvation, or quality issues detected.</div>
        </div></div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
          {alerts.map((a,i) => {
            const c = cfg[a.severity]||cfg.info;
            return (
              <div key={i} style={{ display:'flex', gap:'0.85rem', padding:'1rem 1.1rem', background:c.bg, border:`1px solid ${c.border}`, borderLeft:`4px solid ${c.border}`, borderRadius:9 }}>
                <div style={{ marginTop:2, flexShrink:0 }}>{c.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.35rem' }}>
                    <div style={{ fontWeight:700, fontSize:'0.9rem', color:'#1e293b' }}>{a.title}</div>
                    <span className={c.cls}>{typeLabel[a.type]}</span>
                  </div>
                  <div style={{ fontSize:'0.83rem', color:'#374151', lineHeight:1.55 }}>{a.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── LOGS ─────────────────────────────────────────────────────────────── */
function LogsPage({ results }) {
  const dl = () => {
    if (!results?.raw_logs) return;
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([results.raw_logs.join('\n')],{type:'text/plain'}));
    a.download='simulation_log.txt'; a.click();
  };
  return (
    <div className="main-content">
      <div className="page-header">
        <div className="page-header-left"><h2>Raw Simulation Logs</h2><div className="page-subtitle">Chronological event trace from the discrete-event engine</div></div>
        <button className="sim-config-btn" onClick={dl} style={{ background:'#10b981', marginBottom:0, width:'auto' }}><Download size={15}/> Download .txt</button>
      </div>
      <div className="chart-card" style={{ padding:0 }}>
        <div className="terminal-box" style={{ borderRadius:10 }}>
          {results?.raw_logs
            ? results.raw_logs.map((line,i) => (
                <div key={i} className={`terminal-line ${line.includes('WARNING')?'warning':line.includes('Completed')?'highlight':line.includes('fail')||line.includes('Rework')?'error':''}`}>{line}</div>
              ))
            : <span style={{ color:'#475569' }}>Awaiting simulation execution…</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── VISUAL LINE EDITOR ─────────────────────────────────────────────── */
function VisualLinePage({ 
  sessionConfig, setSessionConfig, handleSimulate, isSimulating, 
  simHours, setSimHours, numRuns, setNumRuns, routingLogic, setRoutingLogic, 
  compiledRoutingModels, setCompiledRoutingModels, isBundle, setIsBundle,
  setModalOpen, isSaving, handleSaveConfig, 
  isFullView, setIsFullView, 
  setSessionProblemName
}) {
  const isPlaying = useSimStore(s => s.isPlaying);
  const togglePlay = useSimStore(s => s.togglePlay);
  const setSpeed = useSimStore(s => s.setSpeed);
  const playSpeed = useSimStore(s => s.playSpeed);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedProduct, setSelectedProduct] = useState('All');
  const [editingNode, setEditingNode] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editingEdge, setEditingEdge] = useState(null);
  const [edgeForm, setEdgeForm] = useState({});

  const [modalTab, setModalTab] = useState('props');
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  const nodeTypes = useMemo(() => ({ machine: MachineNode }), []);
  const edgeTypes = useMemo(() => ({ animated: AnimatedEdge }), []);

  // Progressive Discovery States (using props now)
  const [revealedNodes, setRevealedNodes] = useState(new Set());

  // Products come from the blueprints source (Inventory)
  const products = useMemo(() => {
    const fromBlueprints = (sessionConfig?.product_blueprints || []).map(bp => bp.name);
    const fromDemand = (sessionConfig?.demand || []).map(d => d.product);
    return ['All', ...new Set([...fromBlueprints, ...fromDemand])].filter(Boolean);
  }, [sessionConfig]);

  const materialTypes = useMemo(() => {
    if (!sessionConfig?.buffers) return [];
    return [...new Set(sessionConfig.buffers.map(b => b.material_type))].filter(Boolean);
  }, [sessionConfig]);

  useEffect(() => {
    setRevealedNodes(new Set());
  }, [selectedProduct]);

  useEffect(() => {
    if (!sessionConfig?.nodes) return;

    const allConfigNodes = sessionConfig?.nodes || [];
    const allBuffers = (sessionConfig?.buffers || []).filter(
      b => b.from && b.to && b.from !== 'nan' && b.to !== 'nan'
    );
    const layout = sessionConfig.layout || {};

    // --- 1. EXPAND NODES (Optional Unbundling) ---
    const displayNodes = [];
    allConfigNodes.forEach(n => {
      const count = (n.count || 1);
      if (!isBundle && count > 1) {
        for (let i = 0; i < count; i++) {
          const id = `${n.name}_${i}`;
          displayNodes.push({ ...n, id, originalName: n.name, instance: i, isInstance: true });
        }
      } else {
        displayNodes.push({ ...n, id: n.name, originalName: n.name, isInstance: false });
      }
    });

    // --- 2. COORDINATE LOGIC (Topological Sort Flow) ---
    const getNodesWithPos = (inputNodes) => {
      // 2a. Calculate Ranks for 'All' view flow
      const ranks = {};
      const incoming = {};
      const adj = {};
      
      const allUniqueNames = [...new Set(inputNodes.map(n => n.originalName))];
      allUniqueNames.forEach(name => { 
        incoming[name] = 0; 
        adj[name] = []; 
        ranks[name] = 0; 
      });

      allBuffers.forEach(b => {
        if (incoming[b.to] !== undefined && incoming[b.from] !== undefined) {
          incoming[b.to]++;
          adj[b.from].push(b.to);
        }
      });

      let queue = allUniqueNames.filter(name => incoming[name] === 0);
      let visited = new Set();
      let currentLevel = 0;

      while (queue.length > 0) {
        let nextQueue = [];
        for (let nodeName of queue) {
          if (visited.has(nodeName)) continue;
          visited.add(nodeName);
          ranks[nodeName] = currentLevel;
          (adj[nodeName] || []).forEach(neighbor => {
            incoming[neighbor]--;
            if (incoming[neighbor] <= 0) nextQueue.push(neighbor);
          });
        }
        queue = nextQueue;
        currentLevel++;
      }

      // 2b. Assign positions
      const levelCounts = {};

      return inputNodes.map((n, idx) => {
        // 1. Manual Layout Priority
        if (layout[n.id]) return { ...n, x: layout[n.id].x, y: layout[n.id].y };
        
        // 2. Linear Path for Product Specific View
        if (selectedProduct !== 'All') {
          const blueprint = (sessionConfig?.product_blueprints || []).find(bp => bp.name === selectedProduct);
          const path = blueprint?.path || [];
          const pathIdx = path.indexOf(n.originalName);
          if (pathIdx !== -1) {
            const yOffset = n.isInstance ? (n.instance * 180) : 0;
            return { ...n, x: pathIdx * 320 + 100, y: 250 + yOffset };
          }
          return { ...n, x: 100, y: 100 };
        }

        // 3. Topological Flow for 'All' View
        const r = ranks[n.originalName] || 0;
        levelCounts[r] = (levelCounts[r] || 0) + 1;
        const row = levelCounts[r] - 1;
        
        // Handle unbundled instances within the same rank
        const instanceOffset = n.isInstance ? (n.instance * 60) : 0;
        
        // Fallback: If r is 0 and there are many such nodes, spread them out anyway (vertical stack)
        // This prevents overlapping if no edges were found.
        const xPos = r * 300 + 100;
        const yPos = row * 220 + 120 + instanceOffset;

        return { ...n, x: xPos, y: yPos };
      });
    };

    const positionedNodes = getNodesWithPos(displayNodes);

    // 3. Relevant filtering & Visual Path Compaction
    let relevantNodeIds = new Set();
    const visualEdges = [];

    // Helper to find visual successors (jumping over hidden nodes)
    const findVisualSuccessors = (startNodeName, currentPath = [], visited = new Set()) => {
      const results = [];
      const queue = [{ name: startNodeName, trail: [] }];
      const seen = new Set([startNodeName]);

      while (queue.length > 0) {
        const { name, trail } = queue.shift();
        const neighbors = allBuffers.filter(b => b.from === name);

        for (const edge of neighbors) {
          if (seen.has(edge.to)) continue;
          
          const isVisual = positionedNodes.some(pn => pn.originalName === edge.to);
          if (isVisual) {
            results.push({ to: edge.to, trail: [...trail, name !== startNodeName ? name : null].filter(Boolean), material: edge.material_type });
          } else {
            seen.add(edge.to);
            queue.push({ name: edge.to, trail: [...trail, edge.to] });
          }
        }
      }
      return results;
    };

    if (selectedProduct === 'All') {
      relevantNodeIds = new Set(positionedNodes.map(n => n.id));
      
      // For each visual node, find the next visual node(s)
      const visualNodeNames = [...new Set(positionedNodes.map(n => n.originalName))];
      visualNodeNames.forEach(vName => {
        const successors = findVisualSuccessors(vName);
        successors.forEach(succ => {
          // Map to all instances
          const sourceInstances = positionedNodes.filter(pn => pn.originalName === vName);
          const targetInstances = positionedNodes.filter(pn => pn.originalName === succ.to);
          
          sourceInstances.forEach((s, sIdx) => {
            if (!targetInstances.length) return;
            const t = targetInstances[sIdx % targetInstances.length];
            const bufferName = succ.trail.join(', ');
            visualEdges.push({
              id: `ve-${s.id}-${t.id}-${succ.material}`,
              source: s.id,
              target: t.id,
              type: 'animated',
              label: bufferName ? `via ${bufferName}` : succ.material,
              data: { 
                bufferName: bufferName,
                material: succ.material,
                trail: succ.trail
              },
              animated: true,
              style: { stroke: '#94a3b8', strokeWidth: 2, opacity: 0.8 },
              labelStyle: { fill: '#64748b', fontSize: 10, fontWeight: 700 },
              labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9, rx: 4 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }
            });
          });
        });
      });
    } else {
      // Product specific view
      const blueprint = (sessionConfig?.product_blueprints || []).find(bp => bp.name === selectedProduct);
      if (blueprint && blueprint.path?.length > 0) {
        const pathSet = new Set(blueprint.path);
        positionedNodes.forEach(n => { if (pathSet.has(n.originalName)) relevantNodeIds.add(n.id); });
        
        // Similar compaction but filtered by product path
        blueprint.path.forEach((vName, idx) => {
          if (idx === blueprint.path.length - 1) return;
          const nextVName = blueprint.path[idx+1];
          
          const sourceInstances = positionedNodes.filter(pn => pn.originalName === vName);
          const targetInstances = positionedNodes.filter(pn => pn.originalName === nextVName);
          
          sourceInstances.forEach((s, sIdx) => {
            if (!targetInstances.length) return;
            const t = targetInstances[sIdx % targetInstances.length];
            visualEdges.push({
              id: `ve-prod-${s.id}-${t.id}`,
              source: s.id,
              target: t.id,
              type: 'animated',
              animated: true,
              style: { stroke: '#3b82f6', strokeWidth: 3 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' }
            });
          });
        });
      }
    }

    setNodes(positionedNodes.filter(n => relevantNodeIds.has(n.id)).map(n => ({
        id: n.id,
        type: 'machine',
        position: { x: n.x, y: n.y },
        data: { 
          ...n,
          label: n.isInstance ? `${n.originalName} (${n.instance + 1})` : n.originalName,
          statusKey: n.id,
          onEdit: () => {
            setEditingNode({ id: n.id, data: n });
            setEditForm({ 
                label: n.originalName, count: n.count, failure_rate: n.failure_rate, 
                repair_time: n.repair_time, setup_time: n.setup_time, yield_rate: n.yield_rate,
                process_mean: n.process_time_dist?.mean || 10
            });
          }
        }
    })));
    setEdges(visualEdges);
  }, [sessionConfig, selectedProduct, isFullView, revealedNodes, isBundle]);

  const onNodeDragStop = (event, node) => {
    setSessionConfig(prev => {
      const newLayout = { ...(prev.layout || {}), [node.id]: node.position };
      return { ...prev, layout: newLayout };
    });
  };

  const onNodeClick = (event, node) => {
    if (isFullView) return;
    setRevealedNodes(prev => {
      const next = new Set(prev);
      next.add(node.id);
      return next;
    });
  };

  const onConnect = (params) => {
    const mat = selectedProduct === 'All' ? (materialTypes[0] || 'Part') : selectedProduct;
    setEdges((eds) => addEdge({
      ...params, animated: true, label: mat,
      style: { stroke: '#3b82f6', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' }
    }, eds));
    setSessionConfig(prev => ({
      ...prev,
      buffers: [...(prev.buffers || []), {
        from: params.source, to: params.target,
        material_type: mat, capacity: 99999, probability: 1.0
      }]
    }));
  };

  const onNodeDoubleClick = (event, node) => {
    setEditingNode(node);
    let initialForm = { ...node.data };
    
    // special: if it's the raw water tank, pull in the global generation params
    if (node.id === 'W1_RawWater' && sessionConfig?.global_params) {
      initialForm = { ...initialForm, ...sessionConfig.global_params };
    }
    
    setEditForm(initialForm);
  };

  const onEdgeDoubleClick = (event, edge) => {
    event.stopPropagation();
    const trail = edge.data?.trail || [];
    const bufferName = trail[0]; // Primary buffer in the sequence
    const cap = bufferName ? (sessionConfig?.tanks?.[bufferName]?.capacity || 99999) : 99999;
    
    setEdgeForm({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      material_type: edge.data?.material || '',
      capacity: cap === 99999 ? '' : cap,
      probability: 1.0,
      bufferName: bufferName
    });
    setEditingEdge(edge);
  };

  const saveEdgeChanges = () => {
    const cap = edgeForm.capacity === '' ? 99999 : parseInt(edgeForm.capacity);
    const bName = edgeForm.bufferName;
    
    setSessionConfig(prev => {
      const next = { ...prev };
      if (bName && next.tanks?.[bName]) {
        next.tanks[bName].capacity = cap;
      }
      return next;
    });

    setEdges(eds => eds.map(e => e.id === editingEdge.id
      ? { ...e, data: { ...e.data, capacity: cap } }
      : e
    ));
    setEditingEdge(null);
  };

  const deleteEdge = () => {
    setSessionConfig(prev => ({
      ...prev,
      buffers: prev.buffers.filter(b => !(b.from === editingEdge.source && b.to === editingEdge.target))
    }));
    setEdges(eds => eds.filter(e => e.id !== editingEdge.id));
    setEditingEdge(null);
  };

  const onNodesDelete = (deleted) => {
    setSessionConfig(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => !deleted.some(d => d.id === n.name)),
      buffers: prev.buffers.filter(b => !deleted.some(d => d.id === b.from || d.id === b.to))
    }));
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type || !reactFlowInstance) return;

    const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    
    const newNodeName = `Machine_${Math.floor(Math.random()*1000)}`;
    const newNodeObj = {
      name: newNodeName,
      count: 1,
      is_assembly: type === 'assembly',
      process_time_dist: { type: 'normal', mean: 10, std: 1 },
      yield_rate: 1.0,
      failure_rate: 0.0,
      repair_time: 0,
      x: position.x,
      y: position.y
    };

    setSessionConfig(prev => ({
      ...prev,
      nodes: [...(prev.nodes || []), newNodeObj]
    }));
    setRevealedNodes(prev => {
      const next = new Set(prev);
      next.add(newNodeName);
      return next;
    });
  };

  const onEdgesDelete = (deleted) => {
    setSessionConfig(prev => ({
      ...prev,
      buffers: prev.buffers.filter(b => !deleted.some(e => e.source === b.from && e.target === b.to))
    }));
  };

  const [isCompiling, setIsCompiling] = useState(false);

  const saveNodeChanges = async () => {
    if (!editingNode) return;
    
    const oldName = editingNode.id;
    const newName = editForm.label || oldName;

    // 1. Logic Compilation (AI)
    const rawLogic = routingLogic[oldName];
    if (rawLogic && rawLogic.trim().length > 0) {
      setIsCompiling(true);
      try {
        const dests = edges.filter(e => e.source === oldName).map(e => e.target);
        const res = await fetch(`${API_BASE}/interpret-logic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machine_name: newName, layman_rule: rawLogic, destinations: dests })
        });
        const data = await res.json();
        if (data.status === 'success') {
          setCompiledRoutingModels(prev => {
            const next = { ...prev };
            delete next[oldName];
            next[newName] = data.routing_model;
            return next;
          });
        }
      } catch (e) { console.error("Logic compilation error", e); }
      setIsCompiling(false);
    }

    // 2. State Sync (Rename + Props)
    setSessionConfig(prev => {
      const newNodes = (prev.nodes || []).map(n => n.name === oldName ? {
        ...n,
        name: newName,
        count: parseInt(editForm.count) || 1,
        flow_rate: parseFloat(editForm.flow_rate) || 5.0,
        max_resin_cap: parseFloat(editForm.max_resin_cap) || 0,
        regen_threshold: parseFloat(editForm.regen_threshold) || 80,
        failure_rate: parseFloat(editForm.failure_rate) || 1000,
        repair_time: parseFloat(editForm.repair_time) || 60,
        setup_time: parseFloat(editForm.setup_time) || 0,
        yield_rate: parseFloat(editForm.yield_rate) || 1.0,
        source_output: editForm.source_output || null,
        process_time_dist: {
          type: 'normal',
          mean: parseFloat(editForm.process_mean) || 10,
          std: parseFloat(editForm.process_std) || 1
        }
      } : n);

      let newGlobals = prev.global_params || {};
      if (oldName === 'W1_RawWater') {
        newGlobals = {
          ...newGlobals,
          Interarrival_Mean_min: parseFloat(editForm.Interarrival_Mean_min),
          Batch_Size_Min_m3: parseFloat(editForm.Batch_Size_Min_m3),
          Batch_Size_Max_m3: parseFloat(editForm.Batch_Size_Max_m3),
          Influent_Hardness_eq_per_m3: parseFloat(editForm.Influent_Hardness_eq_per_m3),
        };
      }

      return { ...prev, nodes: newNodes, global_params: newGlobals };

      const newBuffers = (prev.buffers || []).map(b => ({
        ...b,
        from: b.from === oldName ? newName : b.from,
        to: b.to === oldName ? newName : b.to
      }));

      const newBlueprints = (prev.product_blueprints || []).map(bp => ({
        ...bp,
        path: (bp.path || []).map(p => p === oldName ? newName : p)
      }));

      return { ...prev, nodes: newNodes, buffers: newBuffers, product_blueprints: newBlueprints };
    });

    // 3. Update routing logic keys if renamed
    if (newName !== oldName) {
      setRoutingLogic(prev => {
        const next = { ...prev };
        next[newName] = next[oldName];
        delete next[oldName];
        return next;
      });
    }

    // 4. Update local nodes state to reflect rename/props instantly
    setNodes(nds => nds.map(n => n.id === oldName ? { ...n, id: newName, data: { ...n.data, ...editForm } } : n));
    setEditingNode(null);
  };

  const fieldStyle = { width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid #e2e8f0', marginTop: 3, fontSize: '0.85rem', outline: 'none' };
  const labelStyle = { fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <div className="main-content" ref={reactFlowWrapper} style={{ display:'flex', height:'100%' }}>
      <style>{`
        .palette-item { background: white; border: 1px solid #e2e8f0; padding: 0.75rem; border-radius: 8px; margin-bottom: 0.75rem; cursor: grab; font-size: 0.8rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s; }
        .palette-item:hover { border-color: #3b82f6; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        
        .machine-card-node { 
          background: rgba(255, 255, 255, 0.9) !important; 
          backdrop-filter: blur(8px) !important;
          border: 1px solid rgba(226, 232, 240, 0.8) !important; 
          border-radius: 16px !important; 
          padding: 0 !important; 
          width: 230px !important; 
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.04), 0 4px 6px -2px rgba(0, 0, 0, 0.02) !important; 
          font-family: 'Inter', sans-serif !important;
          overflow: visible !important;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        .machine-card-node:hover {
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
          transform: translateY(-4px) !important;
          border-color: #3b82f6 !important;
        }

        .node-header { 
          display: flex !important; 
          align-items: center !important; 
          justify-content: space-between !important;
          padding: 12px 16px !important;
          background: rgba(248, 250, 252, 0.5) !important;
          border-bottom: 1px solid rgba(226, 232, 240, 0.6) !important;
        }

        .node-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          position: relative;
        }
        .node-status-dot::after {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          background: inherit;
          border-radius: inherit;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(3); opacity: 0; }
        }

        .node-body {
          padding: 16px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
        }

        .node-process-box {
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 12px !important;
          padding: 12px !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
        }

        .node-spinner {
          width: 24px;
          height: 24px;
          border: 3px solid #e2e8f0;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        .pulse {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
          animation: pulse-ring 1.5s infinite cubic-bezier(0.66, 0, 0, 1);
        }
        @keyframes pulse-ring {
          to {
            box-shadow: 0 0 10px 10px rgba(34, 197, 94, 0);
          }
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .node-process-info {
          display: flex !important;
          flex-direction: column !important;
          min-width: 0 !important;
          flex: 1 !important;
        }
        .job-label {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.62rem;
          font-weight: 800;
          color: white;
          text-transform: uppercase;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .node-process-label { font-size: 0.65rem !important; color: #94a3b8 !important; text-transform: uppercase; font-weight: 700; }
        .node-process-value { font-size: 0.8rem !important; color: #1e293b !important; font-weight: 600; }

        .node-metrics-grid {
          display: grid !important;
          grid-template-columns: repeat(3, 1fr) !important;
          gap: 8px !important;
        }

        .metric-unit {
          background: white !important;
          border: 1px solid #f1f5f9 !important;
          border-radius: 8px !important;
          padding: 6px !important;
          text-align: center !important;
        }
        .metric-unit-label { font-size: 0.55rem !important; color: #94a3b8 !important; text-transform: uppercase; margin-bottom: 2px; }
        .metric-unit-value { font-size: 0.75rem !important; color: #0f172a !important; font-weight: 700; }

        .node-footer {
          padding: 10px 16px !important;
          background: rgba(248, 250, 252, 0.3) !important;
          border-top: 1px solid rgba(226, 232, 240, 0.6) !important;
          font-size: 0.65rem !important;
          color: #94a3b8 !important;
          display: flex !important;
          justify-content: space-between !important;
        }

        .react-flow__edge { stroke: #cbd5e1 !important; stroke-width: 2 !important; }
        .react-flow__edge.selected { stroke: #3b82f6 !important; stroke-width: 3 !important; }
        .react-flow__edge-label { font-family: inherit !important; font-size: 10px !important; font-weight: 600 !important; }

        /* Hide number input arrows */
        input::-webkit-outer-spin-button,
        input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      {/* ── DRAGGABLE SIDEBAR ── */}
      <div style={{ width: 220, borderRight: '1px solid #e2e8f0', background: '#f8fafc', padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: '0.85rem', marginBottom: '1.25rem', color: '#475569' }}>Machine Palette</h3>
        <div className="palette-item" onDragStart={(n)=>n.dataTransfer.setData('application/reactflow','standard')} draggable>
          <div style={{ width:12, height:12, borderRadius:3, background:'#10b981' }}/> Standard Machine
        </div>
        <div className="palette-item" onDragStart={(n)=>n.dataTransfer.setData('application/reactflow','assembly')} draggable>
          <div style={{ width:12, height:12, borderRadius:3, background:'#f59e0b' }}/> Assembly Node
        </div>
        <div style={{ marginTop:'auto', fontSize:'0.7rem', color:'#94a3b8', fontStyle:'italic' }}>
          💡 Drag into canvas to add new machines
        </div>
      </div>

      <div style={{ flex:1, position:'relative', display:'flex', flexDirection:'column' }}>
        
        {/* ── INTERACTIVE SEQUENCE TOOLBAR ── */}
        <div style={{ background:'white', padding:'0.75rem 1.25rem', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', zIndex:10, flexWrap:'wrap', gap:'1rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
              <span style={{ fontSize:'0.75rem', fontWeight:800, color:'#64748b', textTransform:'uppercase' }}>Visual Focus:</span>
              <select value={selectedProduct} onChange={e=>setSelectedProduct(e.target.value)}
                      style={{ padding:'0.4rem 0.75rem', borderRadius:8, border:'1.5px solid #e2e8f0', fontSize:'0.85rem', fontWeight:600, minWidth:160 }}>
                {products.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', paddingLeft:'1rem', borderLeft:'1.5px solid #f1f5f9' }}>
               <span style={{ fontSize:'0.75rem', fontWeight:800, color:'#3b82f6', textTransform:'uppercase' }}>View Mode:</span>
               <button 
                  onClick={() => setIsBundle(!isBundle)}
                  style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.4rem 0.8rem', borderRadius:8, border:'1.5px solid #e2e8f0', background: isBundle ? '#f1f5f9' : '#0f172a', color: isBundle ? '#0f172a' : 'white', fontSize:'0.78rem', fontWeight:700, cursor:'pointer' }}
               >
                 {isBundle ? <Layout size={14}/> : <Cpu size={14}/>}
                 {isBundle ? "Bundle Parallel" : "Show All Cards"}
               </button>
               <div style={{ marginLeft: '1rem', padding: '2px 8px', borderRadius: 4, background: '#f1f5f9', fontSize: '0.65rem', fontWeight: 700, color: '#64748b' }}>
                 ID: {selectedProduct} Sequence
               </div>
            </div>

            {selectedProduct !== 'All' && (
               <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', paddingLeft:'1rem', borderLeft:'1.5px solid #f1f5f9' }}>
                  <span style={{ fontSize:'0.75rem', fontWeight:800, color:'#10b981', textTransform:'uppercase' }}>Modify Sequence:</span>
                 <select 
                    value="" 
                    onChange={e => {
                      const machineName = e.target.value;
                      if (!machineName) return;
                      setSessionConfig(prev => {
                        const blueprints = [...(prev.product_blueprints || [])];
                        const idx = blueprints.findIndex(bp => bp.name === selectedProduct);
                        if (idx !== -1) {
                          const bp = { ...blueprints[idx] };
                          bp.path = [...(bp.path || []), machineName];
                          blueprints[idx] = bp;
                          return { ...prev, product_blueprints: blueprints };
                        }
                        return prev;
                      });
                    }}
                    style={{ padding:'0.4rem 0.75rem', borderRadius:8, border:'1.5px dashed #3b82f6', color:'#3b82f6', fontSize:'0.85rem', fontWeight:700, background:'#eff6ff' }}
                  >
                    <option value="">+ Append Station to Path</option>
                    {(sessionConfig?.nodes || []).map(n => <option key={n.name} value={n.name}>{n.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
            {/* Simulation Config */}
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', borderRight:'1.5px solid #f1f5f9', paddingRight:'0.6rem' }}>
                <span style={{ fontSize:'0.7rem', fontWeight:800, color:'#64748b' }}>TIME:</span>
                <input type="number" min={1} value={simHours} onChange={e=>setSimHours(parseInt(e.target.value)||1)} 
                       style={{ width:40, border:'1px solid #e2e8f0', borderRadius:6, padding:'0.2rem', fontSize:'0.82rem', fontWeight:700, textAlign:'center' }} />
                <span style={{ fontSize:'0.7rem', color:'#94a3b8' }}>hrs</span>
                
                <span style={{ fontSize:'0.7rem', fontWeight:800, color:'#64748b', marginLeft:'0.5rem' }}>RUNS:</span>
                <input type="number" min={1} value={numRuns} onChange={e=>setNumRuns(parseInt(e.target.value)||1)} 
                       style={{ width:35, border:'1px solid #e2e8f0', borderRadius:6, padding:'0.2rem', fontSize:'0.82rem', fontWeight:700, textAlign:'center' }} />
            </div>

            <button onClick={() => setIsFullView(!isFullView)} className={isFullView ? 'mode-badge-navy' : 'mode-badge'} style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.45rem 0.75rem', border:'none', cursor:'pointer', fontSize:'0.75rem' }}>
              {isFullView ? <Eye size={14}/> : <EyeOff size={14}/>} {isFullView ? 'Focus' : 'Discovery'}
            </button>
            <button 
              onClick={() => setSessionConfig(prev => ({ ...prev, layout: {} }))} 
              className="mode-badge" 
              style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.45rem 0.75rem', border:'none', cursor:'pointer', fontSize:'0.75rem', background: '#f1f5f9', color: '#64748b' }}
              title="Reset manual positions to automatic topological layout"
            >
              <RotateCcw size={14}/> Reset Order
            </button>
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.45rem 0.75rem', background:'white', borderRadius:8, border:'1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <button 
                onClick={() => togglePlay()} 
                className="mode-badge"
                style={{ border:'none', background:isPlaying?'#eff6ff':'#f8fafc', cursor:'pointer', display:'flex', alignItems:'center', color: isPlaying?'#2563eb':'#1e293b', padding: '4px 8px', margin: 0 }}
              >
                {isPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}
                <span style={{ marginLeft: 4 }}>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
              <div style={{ width: 1, height: 16, background: '#e2e8f0' }}/>
              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', minWidth: 25 }}>{playSpeed}x</span>
              <input 
                type="range" min="0.5" max="500" step="0.5" 
                value={playSpeed} 
                onChange={e => setSpeed(parseFloat(e.target.value))}
                style={{ width:80, cursor:'pointer', accentColor: '#3b82f6' }}
              />
            </div>
            
            <button 
              onClick={() => handleSaveConfig(sessionConfig)} 
              disabled={isSaving} 
              className="btn-primary" 
              style={{ margin:0, background:'#6366f1', width:'auto', padding:'0.45rem 1rem', display:'flex', alignItems:'center', gap:'0.4rem' }}
            >
              {isSaving ? <Download size={14} className="spin"/> : <Download size={14}/>} 
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button 
              onClick={() => handleSimulate({ ...sessionConfig, simulation_time_mins: simHours*60, runs: numRuns })} 
              disabled={isSimulating || !sessionConfig} 
              className="sim-config-btn" 
              style={{ margin:0, background:'#10b981', width:'auto', padding:'0.45rem 1rem', display:'flex', alignItems:'center', gap:'0.4rem' }}
            >
              {isSimulating ? '...' : <><Play size={14} fill="white"/> Run Sim</>}
            </button>
          </div>
        </div>

        {/* ── FLEXSIM-STYLE PLAYBACK CONTROLLER ── */}
        <PlaybackController />

      {/* ── EDIT PANEL OVERLAY ── */}
      {editingNode && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}
             onClick={() => setEditingNode(null)}>
          <div style={{ background:'white', borderRadius:14, width:380, maxHeight:'85vh', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column', overflow:'hidden' }}
               onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background:'#0f172a', padding:'1rem 1.25rem', borderRadius:'14px 14px 0 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', color:'white', fontWeight:700, fontSize:'0.9rem' }}>
                <Settings size={16} color="#60a5fa"/> {editingNode.id}
              </div>
              <button onClick={() => setEditingNode(null)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>
            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid #e2e8f0' }}>
              <button onClick={() => setModalTab('props')} style={{ flex:1, padding:'0.75rem', border:'none', background:modalTab==='props'?'white':'#f8fafc', borderBottom:modalTab==='props'?'2px solid #3b82f6':'none', fontWeight:600, fontSize:'0.75rem', color:modalTab==='props'?'#3b82f6':'#64748b', cursor:'pointer' }}>Properties</button>
              <button onClick={() => setModalTab('routing')} style={{ flex:1, padding:'0.75rem', border:'none', background:modalTab==='routing'?'white':'#f8fafc', borderBottom:modalTab==='routing'?'2px solid #3b82f6':'none', fontWeight:600, fontSize:'0.75rem', color:modalTab==='routing'?'#3b82f6':'#64748b', cursor:'pointer' }}>Smart Routing</button>
            </div>

            {/* Body */}
            <div style={{ padding:'1.25rem', display:'flex', flexDirection:'column', gap:'1rem', overflowY:'auto', flex:1 }}>
              {modalTab === 'props' ? (
                <>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      <strong style={{ color: '#0f172a' }}>{editingNode.id}</strong>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                      Type: {nodes.find(n => n.id === editingNode.id)?.data?.is_assembly ? 'Assembly Node' : 'Process Machine'}
                    </div>
                  </div>

                  {/* Source Material Logic (only if machine has no inputs) */}
                  {edges.filter(e => e.target === editingNode.id).length === 0 && (
                    <div style={{ background: '#f0f9ff', padding: '0.75rem', borderRadius: 8, border: '1px solid #bae6fd', marginBottom: '1rem' }}>
                      <label style={labelStyle}>Primary Injection Material</label>
                      <div style={{ fontSize: '0.62rem', color: '#0369a1', marginBottom: '0.4rem' }}>Since this is a Source machine, select the raw material it produces.</div>
                      <select 
                        value={editForm.source_output || 'Standard'} 
                        onChange={e => setEditForm(f => ({...f, source_output: e.target.value}))}
                        style={fieldStyle}
                      >
                        <option value="Standard">Standard (Auto-detect)</option>
                        {(sessionConfig?.material_types || []).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Special W1_RawWater Global Controls */}
                  {editingNode.id === 'W1_RawWater' && (
                    <div style={{ background:'#fffbeb', borderRadius:8, padding:'0.75rem', border:'1px solid #fde68a', marginBottom:'1rem' }}>
                      <div style={{ fontSize:'0.72rem', fontWeight:800, color:'#b45309', marginBottom:'0.8rem', textTransform:'uppercase', letterSpacing:'0.5px', borderBottom:'1px solid #fde68a', paddingBottom:'0.3rem' }}>
                        Inlet Stream Parameters (Global)
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.8rem' }}>
                        <div>
                          <label style={labelStyle}>Batch Interarrival (Mean)</label>
                          <input type="number" step="1" value={editForm.Interarrival_Mean_min || 0}
                            onChange={e => setEditForm(f => ({...f, Interarrival_Mean_min: e.target.value}))}
                            style={fieldStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>Influent Hardness</label>
                          <input type="number" step="0.1" value={editForm.Influent_Hardness_eq_per_m3 || 0}
                            onChange={e => setEditForm(f => ({...f, Influent_Hardness_eq_per_m3: e.target.value}))}
                            style={fieldStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>Min Batch Size (m³)</label>
                          <input type="number" step="0.5" value={editForm.Batch_Size_Min_m3 || 0}
                            onChange={e => setEditForm(f => ({...f, Batch_Size_Min_m3: e.target.value}))}
                            style={fieldStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>Max Batch Size (m³)</label>
                          <input type="number" step="0.5" value={editForm.Batch_Size_Max_m3 || 0}
                            onChange={e => setEditForm(f => ({...f, Batch_Size_Max_m3: e.target.value}))}
                            style={fieldStyle}/>
                        </div>
                      </div>
                      <div style={{ fontSize:'0.65rem', color:'#d97706', marginTop:'0.6rem', fontStyle:'italic' }}>
                        * These affect how frequently and how much water enters the entire plant.
                      </div>
                    </div>
                  )}

                  {/* Machine Name */}
                  <div>
                    <label style={labelStyle}>Machine Identification Name</label>
                    <input type="text" value={editForm.label || ''}
                      onChange={e => setEditForm(f => ({...f, label: e.target.value}))}
                      style={fieldStyle} placeholder="e.g. Sizer_Cutter_Mark2"/>
                  </div>
                  {/* Machine Count */}
                  <div>
                    <label style={labelStyle}>Parallel Machine Count</label>
                    <input type="number" min="1" value={editForm.count || 1}
                      onChange={e => setEditForm(f => ({...f, count: e.target.value}))}
                      style={fieldStyle}/>
                  </div>
                  {/* Process Time */}
                  <div style={{ background:'#f8fafc', borderRadius:8, padding:'0.75rem', border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#3b82f6', marginBottom:'0.5rem', textTransform:'uppercase', letterSpacing:'0.5px' }}>Process Time Distribution (mins)</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                      <div>
                        <label style={labelStyle}>Mean</label>
                        <input type="number" min="0" step="0.5" value={editForm.process_mean || 10}
                          onChange={e => setEditForm(f => ({...f, process_mean: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                      <div>
                        <label style={labelStyle}>Std Dev</label>
                        <input type="number" min="0" step="0.1" value={editForm.process_std || 1}
                          onChange={e => setEditForm(f => ({...f, process_std: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                    </div>
                  </div>
                  {/* Product Specific Path Control */}
                  {selectedProduct !== 'All' && (
                    <div style={{ background: '#eff6ff', padding: '0.85rem', borderRadius: 8, border: '1px solid #bfdbfe', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                        <Zap size={15} color="#3b82f6"/>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase' }}>Blueprint Sequence</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#3b82f6', marginBottom: '0.75rem' }}>
                        Manage this machine's position in the <strong>{selectedProduct}</strong> manufacturing chain.
                      </div>
                      
                      {(() => {
                        const blueprint = (sessionConfig?.product_blueprints || []).find(bp => bp.name === selectedProduct);
                        const pathIdx = blueprint?.path?.indexOf(editingNode.id);
                        const isInPath = pathIdx !== -1;

                        return isInPath ? (
                          <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                            <div style={{ fontSize:'0.7rem', color:'#1e40af', fontWeight:600 }}>Current Rank: Step {pathIdx + 1}</div>
                            <button 
                              onClick={() => {
                                setSessionConfig(prev => {
                                  const blueprints = [...(prev.product_blueprints || [])];
                                  const bIdx = blueprints.findIndex(bp => bp.name === selectedProduct);
                                  if (bIdx !== -1) {
                                    const bp = { ...blueprints[bIdx] };
                                    bp.path = bp.path.filter(n => n !== editingNode.id);
                                    blueprints[bIdx] = bp;
                                    return { ...prev, product_blueprints: blueprints };
                                  }
                                  return prev;
                                });
                              }}
                              style={{ width:'100%', padding:'0.4rem', background:'#ef4444', color:'white', border:'none', borderRadius:6, fontSize:'0.75rem', fontWeight:700, cursor:'pointer' }}
                            >
                              Remove from {selectedProduct} Path
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => {
                              setSessionConfig(prev => {
                                const blueprints = [...(prev.product_blueprints || [])];
                                const bIdx = blueprints.findIndex(bp => bp.name === selectedProduct);
                                if (bIdx !== -1) {
                                  const bp = { ...blueprints[bIdx] };
                                  bp.path = [...(bp.path || []), editingNode.id];
                                  blueprints[bIdx] = bp;
                                  return { ...prev, product_blueprints: blueprints };
                                }
                                return prev;
                              });
                            }}
                            style={{ width:'100%', padding:'0.4rem', background:'#3b82f6', color:'white', border:'none', borderRadius:6, fontSize:'0.75rem', fontWeight:700, cursor:'pointer' }}
                          >
                            + Append to {selectedProduct} Path
                          </button>
                        );
                      })()}
                    </div>
                  )}
                  {/* Advanced Process Specs */}
                  <div style={{ background:'#f0fdf4', borderRadius:8, padding:'0.75rem', border:'1px solid #bbfcbd' }}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#166534', marginBottom:'0.5rem', textTransform:'uppercase', letterSpacing:'0.5px' }}>Process Specifications</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                      <div>
                        <label style={labelStyle}>Flow Rate (m³/min)</label>
                        <input type="number" min="0.1" step="0.1" value={editForm.flow_rate || 5.0}
                          onChange={e => setEditForm(f => ({...f, flow_rate: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                      <div>
                        <label style={labelStyle}>Resin Cap (eq)</label>
                        <input type="number" min="0" step="100" value={editForm.max_resin_cap || 0}
                          onChange={e => setEditForm(f => ({...f, max_resin_cap: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                      <div>
                        <label style={labelStyle}>Regen Trigger (%)</label>
                        <input type="number" min="0" max="100" value={editForm.regen_threshold || 80}
                          onChange={e => setEditForm(f => ({...f, regen_threshold: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                      <div>
                        <label style={labelStyle}>Setup Time (mins)</label>
                        <input type="number" min="0" step="0.5" value={editForm.setup_time || 0}
                          onChange={e => setEditForm(f => ({...f, setup_time: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                    </div>
                  </div>

                  {/* Reliability */}
                  <div style={{ background:'#fff5f5', borderRadius:8, padding:'0.75rem', border:'1px solid #fecaca' }}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#ef4444', marginBottom:'0.5rem', textTransform:'uppercase', letterSpacing:'0.5px' }}>Reliability (MTBF/MTTR)</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                      <div>
                        <label style={labelStyle}>Weibull MTBF (Beta)</label>
                        <input type="number" min="1" step="10" value={editForm.failure_rate || 1000}
                          onChange={e => setEditForm(f => ({...f, failure_rate: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                      <div>
                        <label style={labelStyle}>Repair Mu (Lognormal)</label>
                        <input type="number" min="1" step="1" value={editForm.repair_time || 60}
                          onChange={e => setEditForm(f => ({...f, repair_time: e.target.value}))}
                          style={fieldStyle}/>
                      </div>
                    </div>
                  </div>

                  {/* Quality */}
                  <div>
                    <label style={labelStyle}>Yield Rate (0.0 – 1.0)</label>
                    <input type="number" min="0" max="1" step="0.01" value={editForm.yield_rate || 1.0}
                      onChange={e => setEditForm(f => ({...f, yield_rate: e.target.value}))}
                      style={fieldStyle}/>
                  </div>
                </>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                  <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#8b5cf6', textTransform:'uppercase', letterSpacing:'0.5px' }}>Layman Routing Logic</div>
                  <div style={{ background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:8, padding:'0.75rem' }}>
                    <p style={{ fontSize:'0.72rem', color:'#6d28d9', margin:'0 0 0.5rem' }}>Describe your routing rule in plain English. The AI will translate this for the simulation engine.</p>
                    <textarea 
                      value={routingLogic[editingNode.id] || ''}
                      onChange={e => setRoutingLogic(prev => ({ ...prev, [editingNode.id]: e.target.value }))}
                      placeholder="e.g. If Packer A has more than 5 items, send to Packer B..."
                      style={{ width:'100%', height:120, border:'1px solid #ddd6fe', borderRadius:6, padding:'0.6rem', fontSize:'0.85rem', fontFamily:'inherit', outline:'none' }}
                    />
                  </div>
                  <div style={{ fontSize:'0.68rem', color:'#94a3b8', fontStyle:'italic' }}>
                    💡 Example: "Send 'Family Pack' to Line 1, else send to Line 2" or "Always go to the machine with the shortest queue."
                  </div>
                </div>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding:'0.75rem 1.25rem', borderTop:'1px solid #e2e8f0', display:'flex', gap:'0.6rem', justifyContent:'flex-end', background:'#f8fafc', borderRadius:'0 0 14px 14px' }}>
              <button 
                onClick={() => {
                  onNodesDelete([editingNode]);
                  setEditingNode(null);
                }}
                style={{ marginRight:'auto', display:'flex', alignItems:'center', gap:'0.4rem', color:'#ef4444', background:'none', border:'none', cursor:'pointer', fontSize:'0.78rem', fontWeight:600 }}>
                <Trash2 size={13}/> Delete Machine
              </button>
              <button className="btn-ghost" onClick={() => setEditingNode(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveNodeChanges} disabled={isCompiling}>
                {isCompiling ? (
                  <><Zap size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }}/> Compiling Logic...</>
                ) : "Save Properties"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDGE / BUFFER EDIT PANEL ── */}
      {editingEdge && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}
             onClick={() => setEditingEdge(null)}>
          <div style={{ background:'white', borderRadius:14, width:360, boxShadow:'0 25px 50px -12px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ background:'#0f172a', padding:'1rem 1.25rem', borderRadius:'14px 14px 0 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', color:'white', fontWeight:700, fontSize:'0.9rem' }}>
                <Zap size={16} color="#60a5fa"/> Buffer: {editingEdge.source} → {editingEdge.target}
              </div>
              <button onClick={() => setEditingEdge(null)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>
            <div style={{ padding:'1.25rem', display:'flex', flexDirection:'column', gap:'0.85rem' }}>
              <div>
                <label style={labelStyle}>Material / Output Type</label>
                <input value={edgeForm.material_type || ''}
                  onChange={e => setEdgeForm(f => ({...f, material_type: e.target.value}))}
                  style={fieldStyle} placeholder="e.g. A_Flute_Sheet"/>
              </div>
              <div>
                <label style={labelStyle}>Buffer Capacity (units — leave blank for unlimited)</label>
                <input type="number" min="1" value={edgeForm.capacity || ''}
                  onChange={e => setEdgeForm(f => ({...f, capacity: e.target.value}))}
                  style={fieldStyle} placeholder="Leave blank = ∞"/>
              </div>
              <div>
                <label style={labelStyle}>Routing Probability (0–1)</label>
                <input type="number" min="0" max="1" step="0.05" value={edgeForm.probability ?? 1.0}
                  onChange={e => setEdgeForm(f => ({...f, probability: e.target.value}))}
                  style={fieldStyle}/>
                <div style={{ fontSize:'0.68rem', color:'#94a3b8', marginTop:2 }}>1.0 = always route here · 0.05 = 5% chance</div>
              </div>
            </div>
            <div style={{ padding:'0.75rem 1.25rem', borderTop:'1px solid #e2e8f0', display:'flex', gap:'0.6rem', justifyContent:'space-between', background:'#f8fafc', borderRadius:'0 0 14px 14px' }}>
              <button onClick={deleteEdge}
                style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:7, padding:'0.45rem 0.9rem', cursor:'pointer', fontWeight:600, fontSize:'0.82rem' }}>
                <Trash2 size={13}/> Delete Connection
              </button>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <button className="btn-ghost" onClick={() => setEditingEdge(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveEdgeChanges}>Save Buffer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CANVAS ── */}
      <div style={{ flex:1, background:'#f1f5f9', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden', position:'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onNodeClick={onNodeClick}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          style={{ width:'100%', height:'100%' }}
          defaultViewport={{ x: 60, y: 60, zoom: 0.85 }}
          connectionLineStyle={{ stroke: '#3b82f6', strokeWidth: 2 }}
          connectionLineType="bezier"
          deleteKeyCode="Delete"
          zoomOnDoubleClick={false} // Prevent zoom conflict
          edgesUpdatable
          edgesFocusable
        >
          <Background color="#cbd5e1" gap={20} size={1}/>
          <Controls />
          <MiniMap nodeColor="#e2e8f0" style={{ borderRadius:8 }}/>
        </ReactFlow>
        {!sessionConfig && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'1rem', color:'#94a3b8', background:'rgba(248,250,252,0.8)', backdropFilter:'blur(2px)', zIndex:10 }}>
            <div style={{ background:'white', padding:'2.5rem', borderRadius:20, boxShadow:'0 20px 25px -5px rgba(0,0,0,0.1)', display:'flex', flexDirection:'column', alignItems:'center', gap:'1rem', border:'1px solid #e2e8f0' }}>
              <div style={{ width:60, height:60, borderRadius:15, background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b' }}>
                <Layout size={32}/>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontWeight:800, color:'#1e293b', fontSize:'1.1rem', marginBottom:'0.25rem' }}>Ready to Architect?</div>
                <div style={{ fontSize:'0.85rem', color:'#64748b', maxWidth:250 }}>Upload an existing problem set or start building your factory layout from a clean slate.</div>
              </div>
              <div style={{ display:'flex', gap:'0.75rem', marginTop:'0.5rem' }}>
                <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:'0.5rem', background:'#0f172a', color:'white', padding:'0.6rem 1.2rem', borderRadius:10, fontSize:'0.85rem', fontWeight:600 }}>
                  <Upload size={16}/> Upload Excel
                  <input type="file" accept=".xlsx" onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const fd = new FormData();
                    fd.append('file', f);
                    fetch(`${API_BASE}/parse-excel`, { method:'POST', body:fd })
                      .then(r => r.json()).then(d => { 
                        if (d.config) {
                          setSessionConfig({
                            ...d.config,
                            nodes: d.config.nodes || [],
                            buffers: d.config.buffers || [],
                            product_blueprints: d.config.product_blueprints || [],
                            demand: d.config.demand || [],
                            material_types: d.config.material_types || []
                          }); 
                          setSessionProblemName(f.name.replace('.xlsx',''));
                        }
                      }).catch(err => alert("Upload failed: " + err.message));
                  }} style={{ display:'none' }}/>
                </label>
                <button onClick={() => {
                          setSessionConfig({ nodes:[], buffers:[], demand:[], products:['Standard'], material_types:['Standard'], product_blueprints:[] });
                        }}
                        style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'white', color:'#1e293b', padding:'0.6rem 1.2rem', borderRadius:10, fontSize:'0.85rem', fontWeight:600, border:'1px solid #e2e8f0' }}>
                  <Plus size={16}/> Start from Scratch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}


function ConfigModal({ setModalOpen, handleSimulate, sessionConfig, setSessionConfig, sessionProblemName, setSessionProblemName, simHours, setSimHours, numRuns, setNumRuns }) {
  const [loading, setLoading] = useState(!sessionConfig); // Only load if we don't have a session config

  const hourPresets = [1, 4, 8, 24, 48, 168];
  const runPresets  = [1, 3, 5, 10, 20];

  // Auto-load default config if session config is empty
  useEffect(() => {
    if (!sessionConfig) {
      setLoading(true);
      fetch(`${API_BASE}/default-config`)
        .then(r => r.json())
        .then(data => {
          setSessionConfig({ ...data.config, bom_recipes: data.config.bom_recipes || [] });
          setSessionProblemName(data.problem_name || 'Problem 3 — Corrugated Packaging');
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [sessionConfig, setSessionConfig, setSessionProblemName]);

  const handleFileUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLoading(true);
    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await fetch(`${API_BASE}/parse-excel`, { method:'POST', body:fd });
      const data = await res.json();
      if (data.config) {
        setSessionConfig({ 
          ...data.config, 
          nodes: data.config.nodes || [],
          buffers: data.config.buffers || [],
          product_blueprints: data.config.product_blueprints || [],
          demand: data.config.demand || [],
          material_types: data.config.material_types || [],
          bom_recipes: data.config.bom_recipes || [] 
        });
        setSessionProblemName(f.name.replace('.xlsx',''));
      }
    } catch { alert('Failed to parse Excel. Is the backend running?'); }
    setLoading(false);
  };

  const updateCount = (idx, val) =>
    setSessionConfig(c => ({ ...c, nodes: c.nodes.map((n,i) => i===idx ? { ...n, count:parseInt(val)||1 } : n) }));

  const updateFailureRate = (idx, val) =>
    setSessionConfig(c => ({ ...c, nodes: c.nodes.map((n,i) => i===idx ? { ...n, failure_rate:parseFloat(val)||0 } : n) }));

  const inputStyle = { padding:'0.45rem 0.65rem', borderRadius:7, border:'1px solid #e2e8f0', fontSize:'0.9rem', fontWeight:600, color:'#1e293b', width:'100px', outline:'none' };
  const presetBtn = (active) => ({ padding:'0.3rem 0.65rem', borderRadius:6, border:'1px solid', fontSize:'0.78rem', fontWeight:600, cursor:'pointer', background:active?'#0f172a':'#f8fafc', color:active?'#fff':'#64748b', borderColor:active?'#0f172a':'#e2e8f0' });

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ display:'flex', flexDirection:'column', overflow:'hidden', maxHeight:'85vh' }}>
        <div className="modal-header">
          <h3><Settings size={18}/> Simulation Config</h3>
          <button className="clear-btn" onClick={() => setModalOpen(false)}>✕</button>
        </div>

        <div className="modal-body" style={{ overflowY:'auto', flex:1, padding:'1.5rem' }}>
          {loading ? (
            <div className="upload-zone"><div style={{ color:'#64748b' }}>⏳ Loading configuration…</div></div>
          ) : sessionConfig && (
            <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>
              {/* Loaded problem banner */}
              <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'0.75rem 1rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontSize:'0.85rem', color:'#166534' }}>
                  ✓ <strong>{sessionProblemName}</strong> — {sessionConfig.nodes?.length} machines · {sessionConfig.buffers?.length} routes · {sessionConfig.demand?.length} products
                </div>
                <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:'0.35rem', fontSize:'0.78rem', color:'#3b82f6', fontWeight:600 }}>
                  <Upload size={13}/> Change Excel
                  <input type="file" accept=".xlsx" onChange={handleFileUpload} style={{ display:'none' }}/>
                </label>
              </div>

              {/* Simulation Parameters */}
              <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'1rem 1.25rem' }}>
                <h4 style={{ margin:'0 0 1rem', fontSize:'0.9rem', color:'#1e293b' }}>⚙️ Simulation Parameters</h4>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.25rem' }}>
                  <div>
                    <div style={{ fontSize:'0.78rem', fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.5rem' }}>Duration</div>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.6rem' }}>
                      <input type="number" min={1} max={8760} value={simHours} onChange={e=>setSimHours(Math.max(1,parseInt(e.target.value)||1))} style={inputStyle}/>
                      <span style={{ fontSize:'0.85rem', color:'#64748b' }}>hrs</span>
                      <span style={{ fontSize:'0.75rem', color:'#94a3b8' }}>= {(simHours*60).toLocaleString()} min</span>
                    </div>
                    <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap' }}>
                      {hourPresets.map(h=><button key={h} style={presetBtn(simHours===h)} onClick={()=>setSimHours(h)}>{h}h</button>)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:'0.78rem', fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.5rem' }}>Simulation Runs</div>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.6rem' }}>
                      <input type="number" min={1} max={50} value={numRuns} onChange={e=>setNumRuns(Math.max(1,parseInt(e.target.value)||1))} style={inputStyle}/>
                      <span style={{ fontSize:'0.85rem', color:'#64748b' }}>runs</span>
                    </div>
                    <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap' }}>
                      {runPresets.map(r=><button key={r} style={presetBtn(numRuns===r)} onClick={()=>setNumRuns(r)}>{r}×</button>)}
                    </div>
                    <div style={{ fontSize:'0.72rem', color:'#94a3b8', marginTop:'0.5rem' }}>More runs = higher confidence</div>
                  </div>
                </div>
              </div>

              {/* Machine table */}
              <div>
                <h4 style={{ margin:'0 0 0.75rem', fontSize:'0.9rem', color:'#1e293b' }}>Machine Parallel Count</h4>
                <table>
                  <thead><tr><th>Node Name</th><th>Type</th><th>Process</th><th>Setup</th><th>Fail/Repair</th><th>Count</th></tr></thead>
                  <tbody>
                    {sessionConfig.nodes.map((n,i) => (
                      <tr key={i}>
                        <td style={{ fontWeight:600 }}>{n.name}</td>
                        <td>{n.is_assembly?<span className="badge-yellow">Assembly</span>:<span className="badge-green">Standard</span>}</td>
                        <td style={{ fontSize:'0.8rem' }}>{n.process_time_dist?.mean??'—'}m</td>
                        <td style={{ fontSize:'0.8rem', color:'#64748b' }}>{n.setup_time||0}</td>
                        <td style={{ fontSize:'0.72rem' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'0.25rem' }}>
                            <span style={{ color:'#94a3b8' }}>MTBF:</span>
                            <input 
                              type="number" 
                              value={n.failure_rate} 
                              onChange={e=>updateFailureRate(i, e.target.value)}
                              style={{ width:50, padding:'2px 4px', border:'1px solid #e2e8f0', borderRadius:4, fontWeight:700, color:'#ef4444' }}
                            />
                            <span style={{ color:'#94a3b8' }}>/ {n.repair_time}m</span>
                          </div>
                        </td>
                        <td><input type="number" value={n.count} min={1} onChange={e=>updateCount(i,e.target.value)} style={{ width:50, padding:'0.3rem 0.4rem', borderRadius:6, border:'1px solid #e2e8f0', fontWeight:600 }}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
          {sessionConfig && (
            <button className="btn-primary" onClick={() => handleSimulate({ ...sessionConfig, simulation_time_mins:simHours*60, runs:numRuns })}>
              ▶ Run {numRuns}× · {simHours}h simulation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── APP ROOT ─────────────────────────────────────────────────────────── */
export default function App() {
  const [results,      setResults]      = useState(null);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [chatHistory,  setChatHistory]  = useState([{ role: 'assistant', content: 'Hi, I am your assistant.' }]);
   const [isSimulating, setIsSimulating] = useState(false);
   const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

   const handleSaveConfig = (cfg) => {
     setIsSaving(true);
     setSessionConfig(cfg);
     setTimeout(() => setIsSaving(false), 600);
   };

  // Persistent session config and problem name
  const [sessionConfig,      setSessionConfig]      = useState(null);
  const [sessionProblemName, setSessionProblemName] = useState('');
  const [aiWidth, setAiWidth] = useState(380);
  const isResizing = useRef(false);

  const startResizing = (e) => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  };

  const handleMouseMove = (e) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 280 && newWidth < 800) {
      setAiWidth(newWidth);
    }
  };

  const [simHours, setSimHours] = useState(48);
  const [numRuns, setNumRuns] = useState(5);
  const [routingLogic, setRoutingLogic] = useState({});
  const [compiledRoutingModels, setCompiledRoutingModels] = useState({});
  const [isBundle, setIsBundle] = useState(true);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isFullView, setIsFullView] = useState(false);

  const tick = useSimStore(s => s.tick);
  const lastTickRef = useRef(performance.now());

  useEffect(() => {
    let frameId;
    const loop = (t) => {
      const dt = t - lastTickRef.current;
      lastTickRef.current = t;
      // The tick function inside useSimStore already uses playSpeed effectively
      tick(dt); 
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [tick]);

  const askAI = async (prompt, resOverride=null) => {
    setChatHistory(prev => [...prev, { role:'user', content:prompt }]);
    const r = resOverride||results;
    
    // Check if this is a "What-If" proposal
    const isWhatIf = /what if|propose|change|add|increase|decrease|reduce|multiply/i.test(prompt);

    try {
      if (isWhatIf && sessionConfig) {
        // Match duration to the current baseline results to ensure fair comparison
        const sandboxTime = r?.sim_time || (simHours * 60);
        
        const res = await fetch(`${API_BASE}/what-if`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ 
            config: { ...sessionConfig, simulation_time_mins: sandboxTime }, 
            prompt 
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          setChatHistory(prev => [...prev, { 
            role:'assistant', 
            content: data.analysis,
            whatIf: {
              changes: data.changes,
              newThroughput: data.delta_results.average_throughput,
              oldThroughput: r?.average_throughput || 0,
              numRuns: data.delta_results.runs 
            }
          }]);
          return;
        }
      }

      const res = await fetch(`${API_BASE}/analyze`, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ 
          throughput: r?.average_throughput||0, 
          queues: r?.sample_queue_trace||{}, 
          prompt, 
          history: chatHistory.slice(-4) 
        }),
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role:'assistant', content:data.analysis }]);
    } catch {
      setChatHistory(prev => [...prev, { role:'assistant', content:'AI unavailable — check backend.' }]);
    }
  };

  const handleSimulate = async (cfg) => {
    setModalOpen(false);
    setIsSimulating(true);
    try {
      const res = await fetch(`${API_BASE}/simulate`, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ config: { ...cfg, routing_models: compiledRoutingModels } }),
      });
      const data = await res.json();
      setResults(data.results);
      
      // Start Live Replay
      if (data.results.animation_trace) {
        useSimStore.getState().setTrace(
          data.results.animation_trace, 
          data.results.sim_time,
          data.results.sample_queue_trace,
          data.results
        );
      }

    } catch(e) {
      alert('Simulation error: '+e.message);
    }
    setIsSimulating(false);
  };

  return (
    <BrowserRouter>
      <div className="dashboard-layout">
        <Sidebar 
          setModalOpen={setModalOpen} 
          setSessionConfig={setSessionConfig}
          setResults={setResults}
          setSessionProblemName={setSessionProblemName}
        />

        <div className="main-wrapper">
          <div className="topbar">
            <div className="topbar-breadcrumb">Digital Twin <span>— Factory Simulator</span></div>
            <div className="topbar-actions">
              {isSimulating && <div className="sim-running-badge">⚙ Simulating…</div>}
              <button 
                onClick={() => setModalOpen(true)} 
                className="mode-badge" 
                style={{ border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:'0.4rem', background:'#f8fafc', color:'#475569' }}
              >
                <Settings size={14}/> Config
              </button>
              <input type="text" className="search-bar" placeholder="🔍  Search…"/>
              <div className="profile-avatar">JD</div>
            </div>
          </div>
          <Routes>
            <Route path="/" element={<LiveDashboard 
              results={results} 
              sessionConfig={sessionConfig} 
              sessionProblemName={sessionProblemName}
              setModalOpen={setModalOpen}
            />}/>
            <Route path="/orders"      element={<OrdersPage results={results} sessionConfig={sessionConfig}/>}/>
            <Route path="/visual-line" element={<VisualLinePage 
              sessionConfig={sessionConfig} 
              setSessionConfig={setSessionConfig} 
              handleSimulate={handleSimulate} 
              isSimulating={isSimulating}
              simHours={simHours}
              setSimHours={setSimHours}
              numRuns={numRuns}
              setNumRuns={setNumRuns}
              routingLogic={routingLogic}
              setRoutingLogic={setRoutingLogic}
              compiledRoutingModels={compiledRoutingModels}
              setCompiledRoutingModels={setCompiledRoutingModels}
              isFullView={isFullView}
              setIsFullView={setIsFullView}
              isBundle={isBundle}
              setIsBundle={setIsBundle}
              setModalOpen={setModalOpen}
              isSaving={isSaving}
              handleSaveConfig={handleSaveConfig}
              setSessionProblemName={setSessionProblemName}
            />}/>
            <Route path="/inventory"   element={<InventoryManager sessionConfig={sessionConfig} setSessionConfig={setSessionConfig} />}/>
            <Route path="/utilization" element={<UtilizationPage results={results}/>}/>
            <Route path="/alerts"      element={<AlertsPage results={results}/>}/>
            <Route path="/logs"        element={<LogsPage results={results}/>}/>
          </Routes>
        </div>

        {/* Resizable Divider */}
        {!isChatCollapsed && (
          <div 
            onMouseDown={startResizing}
            style={{ width: 4, cursor: 'col-resize', background: '#e2e8f0', transition: 'background 0.2s', zIndex: 100 }}
            onMouseEnter={(e)=>e.target.style.background='#3b82f6'}
            onMouseLeave={(e)=>e.target.style.background='#e2e8f0'}
          />
        )}

        <div style={{ 
          flexShrink: 0, 
          width: isChatCollapsed ? 0 : aiWidth, 
          background: 'white', 
          display: 'flex',
          overflow: 'hidden',
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative'
        }}>
          <AIChatPanel 
            chatHistory={chatHistory} 
            setChatHistory={setChatHistory} 
            askAI={askAI} 
            results={results}
            setIsChatCollapsed={setIsChatCollapsed}
          />
        </div>

        {/* Floating Toggle Button (Bottom Right) */}
        {isChatCollapsed && (
          <motion.div 
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="chat-toggle-floating"
            onClick={() => setIsChatCollapsed(false)}
          >
            <div className="toggle-glow" />
            <Bot size={24} />
            <span className="toggle-tooltip">AI Assistant</span>
          </motion.div>
        )}
      </div>

      {modalOpen && (
        <ConfigModal
          setModalOpen={setModalOpen}
          handleSimulate={handleSimulate}
          sessionConfig={sessionConfig}
          setSessionConfig={setSessionConfig}
          sessionProblemName={sessionProblemName}
          setSessionProblemName={setSessionProblemName}
          simHours={simHours}
          setSimHours={setSimHours}
          numRuns={numRuns}
          setNumRuns={setNumRuns}
        />
      )}
    </BrowserRouter>
  );
}

/* ─── WHAT-IF BUBBLE ─────────────────────────────────────────────────── */
function WhatIfBubble({ data }) {
  const diff = data.newThroughput - data.oldThroughput;
  const pct = ((diff / (data.oldThroughput || 1)) * 100).toFixed(1);
  const isPos = diff > 0;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize:'0.75rem', fontWeight:600, color:'#94a3b8', marginBottom:'0.5rem', textTransform:'uppercase' }}>
        What-If Sandbox Preview
      </div>
      <div style={{ background:'#0f172a', borderRadius:8, padding:'0.75rem', border:'1px solid rgba(255,255,255,0.1)', marginBottom:'0.75rem' }}>
        <div style={{ fontSize:'0.7rem', color:'#64748b', marginBottom:'0.25rem' }}>Proposed Changes:</div>
        {data.changes.map((c, i) => <div key={i} style={{ fontSize:'0.82rem', color:'#60a5fa', fontWeight:600 }}>• {c}</div>)}
      </div>

      <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.75rem' }}>
        <div style={{ flex:1, background:'rgba(255,255,255,0.03)', padding:'0.5rem', borderRadius:6 }}>
          <div style={{ fontSize:'0.65rem', color:'#94a3b8' }}>Baseline</div>
          <div style={{ fontSize:'0.9rem', fontWeight:700 }}>{data.oldThroughput.toFixed(1)} <small style={{ fontWeight:400, opacity:0.6 }}>units</small></div>
        </div>
        <div style={{ flex:1, background:isPos?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)', padding:'0.5rem', borderRadius:6 }}>
          <div style={{ fontSize:'0.65rem', color:isPos?'#10b981':'#ef4444' }}>Pro Forma</div>
          <div style={{ fontSize:'0.9rem', fontWeight:700, color:isPos?'#10b981':'#ef4444' }}>{data.newThroughput.toFixed(1)} <small style={{ fontWeight:400, opacity:0.6 }}>units</small></div>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:isPos?'#064e3b':'#450a0a', padding:'0.6rem', borderRadius:8, border:'1px solid', borderColor:isPos?'#059669':'#dc2626' }}>
        <div style={{ fontSize:'1.1rem' }}>{isPos ? '🚀' : '⚠️'}</div>
        <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#fff' }}>
          {isPos ? `Improvement: +${pct}%` : `Decline: ${pct}%`}
        </div>
      </div>
      
      <div style={{ marginTop:'0.75rem', fontSize:'0.75rem', fontStyle:'italic', color:'#64748b' }}>
        Based on {data.numRuns} predictive iterations.
      </div>
    </div>
  );
}
