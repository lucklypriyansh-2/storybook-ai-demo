import { createRoot } from 'react-dom/client';
import './ds.css'; import './app.css'; import './reels.css';
import App from './App';
import { installAudioUnlock } from './render/audio';
installAudioUnlock();
createRoot(document.getElementById('root')!).render(<App />);
