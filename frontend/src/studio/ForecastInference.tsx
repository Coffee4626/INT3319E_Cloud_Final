import {useState} from 'react';
import {api} from '../api';
import {LineChart} from './Visuals';
export function ForecastInference({id, apiKey, inactive}: {id:string; apiKey:string; inactive:boolean}) {
  const [horizon,setHorizon] = useState(7), [custom,setCustom] = useState(false), [history,setHistory] = useState('[]');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [result,setResult] = useState<{timestamp:string;value:number}[]>([]);
  const [latency,setLatency] = useState(0);
  async function predict() {
    setBusy(true); setError(''); setResult([]);
    try {
      const payload = {horizon, ...(custom ? {history:JSON.parse(history)} : {})};
      const start = performance.now();
      const response = await api<{forecasts:{timestamp:string;value:number}[]}>(`/predict/${id}`,payload,'POST',apiKey);
      setResult(response.forecasts); setLatency(Math.round(performance.now()-start));
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <div className="st-playground-grid">
    <section className="st-panel"><h3>Dự báo từ lịch sử</h3>
      <p className="st-muted">Mặc định dùng những quan sát cuối của bộ dữ liệu đã tải lên. Mỗi bước tương ứng khoảng thời gian giữa hai quan sát.</p>
      <label>Số bước cần dự báo<input type="number" min="1" max="30" value={horizon} onChange={e=>setHorizon(+e.target.value)}/></label>
      <label><input type="checkbox" checked={custom} onChange={e=>setCustom(e.target.checked)}/> Dùng lịch sử mới</label>
      {custom && <><p className="st-muted">Mảng JSON gồm timestamp và target, theo thứ tự tăng dần, cùng khoảng thời gian với dữ liệu huấn luyện; đủ số bước lịch sử đã chọn.</p><textarea aria-label="Lịch sử mới" className="st-json-input" rows={10} value={history} onChange={e=>setHistory(e.target.value)}/></>}
      <button className="st-btn" disabled={busy || inactive || !apiKey || !Number.isInteger(horizon) || horizon<1 || horizon>30} onClick={()=>void predict()}>{busy?'Đang dự báo…':'Dự báo'}</button>
      {error && <p className="st-alert error" role="alert">{error}</p>}
    </section>
    <section className="st-panel"><h3>Giá trị tương lai</h3>{result.length ? <>
      <p className="st-muted">{result.length} bước · {latency} ms cho toàn bộ yêu cầu</p>
      <LineChart xLabel="Bước dự báo" xValues={result.map((_,i)=>i+1)} series={[{name:'Dự báo',color:'#3478f5',values:result.map(p=>p.value)}]}/>
      <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Thời gian</th><th>Giá trị</th></tr></thead><tbody>{result.map(p=><tr key={p.timestamp}><td>{p.timestamp}</td><td>{p.value.toLocaleString('vi-VN',{maximumFractionDigits:4})}</td></tr>)}</tbody></table></div>
    </> : <p className="st-muted">Chọn số bước rồi bấm Dự báo để xem đường dự báo và các giá trị.</p>}</section>
  </div>;
}
