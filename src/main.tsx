import { render } from 'preact';
import { App } from './ui/App';
import { startSync } from './ui/store';
import './styles.css';

startSync();
const root = document.getElementById('app');
if (root) render(<App />, root);
