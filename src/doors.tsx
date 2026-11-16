import { render } from 'preact';
import { DoorsApp } from './ui/DoorsApp';
import { startSync } from './ui/store';
import './styles.css';
import './doors.css';

startSync();
const root = document.getElementById('app');
if (root) render(<DoorsApp />, root);
