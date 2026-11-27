export function extendedSample(task: string): File | null {
  let lines: string[];
  if (task === 'anomaly-detection') lines = ['temperature,pressure,vibration', ...Array.from({length:240}, (_,i) => `${24+Math.sin(i)*2+(i%23===0?18:0)},${101+Math.cos(i*1.7)*3},${0.12+Math.sin(i*.7)*.04+(i%23===0?1:0)}`)];
  else if (task === 'clustering') lines = ['frequency,spend,tenure', ...Array.from({length:240}, (_,i) => `${3+(i%3)*8+Math.sin(i)},${100+(i%3)*400+Math.cos(i)*35},${6+(i%3)*12+Math.sin(i*2)*2}`)];
  else if (task === 'text-classification') lines = ['text,label', ...Array.from({length:240}, (_,i) => `${i%2 ? 'Sản phẩm tốt giao hàng nhanh tôi rất hài lòng' : 'Sản phẩm lỗi giao hàng chậm tôi rất thất vọng'} đơn hàng ${i},${i%2?'positive':'negative'}`)];
  else if (task === 'forecasting') lines = ['timestamp,target', ...Array.from({length:240}, (_,i) => `${new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)},${(100+i*.2+Math.sin(i*2*Math.PI/7)*15).toFixed(3)}`)];
  else return null;
  return new File([lines.join('\n')], `${task}-sample.csv`, {type:'text/csv'});
}
