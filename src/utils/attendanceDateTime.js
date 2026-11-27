import { formatAttendanceDate, formatAttendanceTime, getAttendanceDateKey } from './attendanceAnalysis.js';

export const attendanceTimeTyping = value => {
  const text = String(value);
  return !text.includes(':') && /^\d{3,4}$/.test(text) ? `${text.slice(0, 2)}:${text.slice(2)}` : text;
};

export const formatAttendanceDateTime = value => {
  const date = formatAttendanceDate(value);
  return date ? `${date}, ${formatAttendanceTime(value)}` : '';
};

export const attendanceDateTimeInput = value => {
  const date = getAttendanceDateKey(value);
  return date ? `${date}T${formatAttendanceTime(value).slice(0, 5)}` : '';
};

export const attendanceInputToIso = value => {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
    throw new Error('Ingresa una fecha y hora válidas en formato de 24 horas (HH:mm).');
  }
  // Bolivia usa UTC-04:00. No depende del formato ni de la zona del equipo.
  const date = new Date(`${value}:00-04:00`);
  if (!Number.isFinite(date.getTime()) || attendanceDateTimeInput(date) !== value) {
    throw new Error('La fecha y hora de asistencia no son válidas.');
  }
  return date.toISOString();
};
