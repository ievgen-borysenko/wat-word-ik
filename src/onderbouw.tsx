import { render } from 'preact';
import { RouteApp } from './ui/RouteApp';
import { startRouteSync } from './ui/routeStore';
import './styles.css';
import './doors.css';
import './onderbouw.css';

startRouteSync();
const root = document.getElementById('app');
if (root) render(<RouteApp />, root);
