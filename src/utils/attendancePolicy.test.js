import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceNeedsPhoto, getAttendanceWorkReason } from './attendancePolicy.js';

test('company street exemption handles GPS addresses, accents, case and whitespace', () => {
  for (const location of ['Calle Batallón Colorados, Sarco Central, Cochabamba', 'BATALLON COLORADOS', 'Batallón   Colorados', 'Calle Jesús Aguayo, Sarco Central, Cochabamba', 'JESUS AGUAYO', 'Jesús   Aguayo', 'C. J. Aguayo, Sarco', 'Calle J Aguayo']) {
    assert.equal(attendanceNeedsPhoto(location), false);
  }
  for (const location of ['', null, 'Calle Atacama, Sarco', 'Colorados', 'Batallón', 'Batallon Coloradosa', 'Jesús', 'Aguayo', 'Jesus Aguayos', 'Juan Aguayo']) {
    assert.equal(attendanceNeedsPhoto(location), true);
  }
});

test('work reasons agree with attendance interval types', () => {
  assert.equal(getAttendanceWorkReason('entrada'), 'Ingreso trabajo');
  assert.equal(getAttendanceWorkReason('salida'), 'Salida trabajo');
});
