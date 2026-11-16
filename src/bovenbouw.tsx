import { render } from 'preact';
import { ExamApp } from './ui/ExamApp';
import { startExamSync } from './ui/examStore';
import './styles.css';
import './doors.css';
import './onderbouw.css';
import './bovenbouw.css';

startExamSync();
const root = document.getElementById('app');
if (root) render(<ExamApp />, root);
