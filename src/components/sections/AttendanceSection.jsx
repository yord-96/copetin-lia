import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { compressAttendanceImage } from '../../utils/attendancePhotos';
import { getUserDisplayRole } from '../../utils/permissions';

const getInputDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();


const ATTENDANCE_TIME_ZONE = 'America/La_Paz';

const getAttendanceDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatAttendanceDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: ATTENDANCE_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const formatAttendanceTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

const formatAttendanceSpan = (minutes) => {
  const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const getAttendanceEvidenceLabel = (record) => {
  const photoUrl = String(record?.photoUrl ?? '').trim();
  const photoDataUrl = String(record?.photoDataUrl ?? '').trim();
  if (photoUrl) return photoUrl;
  if (photoDataUrl) return 'Evidencia almacenada en el sistema';
  return 'Sin evidencia';
};

const applyAttendanceHeaderStyle = (row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A6B' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 28;
  row.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD7DFEA' } },
      left: { style: 'thin', color: { argb: 'FFD7DFEA' } },
      bottom: { style: 'thin', color: { argb: 'FFD7DFEA' } },
      right: { style: 'thin', color: { argb: 'FFD7DFEA' } },
    };
  });
};

const applyAttendanceDataBorders = (worksheet, startRow, endRow, startColumn, endColumn) => {
  if (endRow < startRow) return;
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      const cell = worksheet.getCell(rowIndex, columnIndex);
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE4E9F0' } },
        left: { style: 'thin', color: { argb: 'FFE4E9F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE4E9F0' } },
        right: { style: 'thin', color: { argb: 'FFE4E9F0' } },
      };
      cell.alignment = { vertical: 'top', wrapText: true };
    }
  }
};

const getAttendancePhotoSource = (record) =>
  String(record?.photoUrl || record?.photoDataUrl || '').trim();

function AttendancePhoto({ src, alt, className = '' }) {
  const [failedSrc, setFailedSrc] = useState('');
  const failed = failedSrc === src;
  if (!src || failed) {
    return <span className="attendance-photo-placeholder">Foto no disponible</span>;
  }
  return <img className={className} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

const buildReadableAddress = (payload, latitude, longitude) => {
  const address = payload?.address ?? {};
  const parts = [
    address.road,
    address.pedestrian,
    address.neighbourhood || address.suburb,
    address.city || address.town || address.village,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  const uniqueParts = [...new Set(parts)];
  if (uniqueParts.length > 0) {
    return uniqueParts.join(', ');
  }
  return String(payload?.display_name ?? '').trim() || `${latitude}, ${longitude}`;
};

const resolveStreetAddress = async (latitude, longitude) => {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'es');

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error('No se pudo convertir la ubicación GPS a calles.');
  }
  return buildReadableAddress(await response.json(), latitude, longitude);
};

function AttendanceSection({
  records = [],
  users = [],
  usersLoading = false,
  currentUser = null,
  formatDateTime,
  canMark = true,
  onLoadRecords,
  onCreateRecord,
}) {
  const [form, setForm] = useState({
    type: 'entrada',
    location: '',
    reason: '',
    latitude: null,
    longitude: null,
  });
  const [photoDraft, setPhotoDraft] = useState(null);
  const [markingMode, setMarkingMode] = useState('personal');
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [manualParticipantNames, setManualParticipantNames] = useState([]);
  const [manualParticipantDraft, setManualParticipantDraft] = useState('');
  const [participantQuery, setParticipantQuery] = useState('');
  const [filters, setFilters] = useState({
    dateFrom: getInputDate(),
    dateTo: getInputDate(),
    type: 'all',
    query: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [isExportingAttendance, setIsExportingAttendance] = useState(false);

  useEffect(() => () => {
    if (photoDraft?.previewUrl) {
      URL.revokeObjectURL(photoDraft.previewUrl);
    }
  }, [photoDraft?.previewUrl]);

  useEffect(() => {
    if (!onLoadRecords) return undefined;
    let disposed = false;
    const timerId = window.setTimeout(async () => {
      setIsReportLoading(true);
      try {
        await onLoadRecords({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          type: filters.type,
          query: filters.query,
          limit: 300,
        });
      } catch (loadError) {
        if (!disposed) setError(loadError.message || 'No se pudo cargar el reporte de asistencia.');
      } finally {
        if (!disposed) setIsReportLoading(false);
      }
    }, filters.query ? 250 : 0);
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [filters.dateFrom, filters.dateTo, filters.type, filters.query, onLoadRecords]);

  const currentTimeLabel = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const todayLabel = new Date().toLocaleDateString('es-BO', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  const todayRecords = useMemo(
    () => records.filter((record) => getInputDate(new Date(record.capturedAt ?? record.createdAt)) === getInputDate()),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const query = normalizeText(filters.query);
    return records.filter((record) => {
      const dateKey = getInputDate(new Date(record.capturedAt ?? record.createdAt));
      if (filters.dateFrom && dateKey < filters.dateFrom) return false;
      if (filters.dateTo && dateKey > filters.dateTo) return false;
      if (filters.type !== 'all' && record.type !== filters.type) return false;
      if (query) {
        const haystack = normalizeText(`${record.code} ${record.userName} ${record.location} ${record.reason} ${record.type} ${record.responsibleName}`);
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [filters, records]);


  const exportAttendanceExcel = async () => {
    if (isExportingAttendance) return;
    setError('');
    setStatus('');
    setIsExportingAttendance(true);
    try {
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default ?? excelModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'El Copetín';
      workbook.company = 'El Copetín';
      workbook.subject = 'Reporte biométrico de asistencia';
      workbook.title = 'Reporte de asistencia';
      workbook.created = new Date();

      const exportSource = await api.attendance.listRecords({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        type: filters.type,
        query: filters.query,
        limit: 1000,
      });
      const exportQuery = normalizeText(filters.query);
      const sortedRecords = (Array.isArray(exportSource) ? exportSource : [])
        .filter((record) => {
          const dateKey = getAttendanceDateKey(record?.capturedAt ?? record?.createdAt);
          if (filters.dateFrom && dateKey < filters.dateFrom) return false;
          if (filters.dateTo && dateKey > filters.dateTo) return false;
          if (filters.type !== 'all' && record?.type !== filters.type) return false;
          if (exportQuery) {
            const haystack = normalizeText(`${record?.code} ${record?.userName} ${record?.location} ${record?.reason} ${record?.type} ${record?.responsibleName}`);
            if (!haystack.includes(exportQuery)) return false;
          }
          return true;
        })
        .sort((left, right) => new Date(left?.capturedAt ?? left?.createdAt ?? 0) - new Date(right?.capturedAt ?? right?.createdAt ?? 0));
      const uniqueUsers = new Set(sortedRecords.map((record) => String(record?.userId || record?.userName || '').trim()).filter(Boolean));
      const entryCount = sortedRecords.filter((record) => record?.type === 'entrada').length;
      const exitCount = sortedRecords.filter((record) => record?.type === 'salida').length;
      const responsibleCount = sortedRecords.filter((record) => record?.markingMode === 'responsable').length;
      const evidenceCount = sortedRecords.filter((record) => getAttendancePhotoSource(record)).length;
      const gpsCount = sortedRecords.filter((record) => Number.isFinite(Number(record?.latitude)) && Number.isFinite(Number(record?.longitude))).length;

      const summarySheet = workbook.addWorksheet('Resumen', {
        views: [{ showGridLines: false }],
      });
      summarySheet.columns = [
        { key: 'label', width: 31 },
        { key: 'value', width: 34 },
      ];
      summarySheet.mergeCells('A1:B1');
      summarySheet.getCell('A1').value = 'EL COPETÍN · REPORTE BIOMÉTRICO DE ASISTENCIA';
      summarySheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 15 };
      summarySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE94A0A' } };
      summarySheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
      summarySheet.getRow(1).height = 32;
      summarySheet.addRow([]);
      [
        ['Período desde', filters.dateFrom || 'Sin límite'],
        ['Período hasta', filters.dateTo || 'Sin límite'],
        ['Filtro de tipo', filters.type === 'entrada' ? 'Entradas' : filters.type === 'salida' ? 'Salidas' : 'Todas'],
        ['Búsqueda aplicada', filters.query || 'Sin búsqueda'],
        ['Zona horaria', ATTENDANCE_TIME_ZONE],
        ['Generado', `${formatAttendanceDate(new Date())} ${formatAttendanceTime(new Date())}`],
        ['Total de marcas', sortedRecords.length],
        ['Entradas', entryCount],
        ['Salidas', exitCount],
        ['Personas con marcas', uniqueUsers.size],
        ['Marcas por responsable', responsibleCount],
        ['Marcas con evidencia fotográfica', evidenceCount],
        ['Marcas con coordenadas GPS', gpsCount],
      ].forEach(([label, value]) => summarySheet.addRow({ label, value }));
      summarySheet.getColumn(1).font = { bold: true, color: { argb: 'FF173A6B' } };
      applyAttendanceDataBorders(summarySheet, 3, summarySheet.rowCount, 1, 2);
      summarySheet.getColumn(2).alignment = { vertical: 'middle', wrapText: true };

      const detailSheet = workbook.addWorksheet('Detalle de marcas', {
        views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
        autoFilter: { from: 'A1', to: 'S1' },
      });
      detailSheet.columns = [
        { header: 'Código', key: 'code', width: 14 },
        { header: 'Fecha', key: 'date', width: 13 },
        { header: 'Hora', key: 'time', width: 12 },
        { header: 'Usuario', key: 'userName', width: 28 },
        { header: 'Cargo / rol', key: 'role', width: 20 },
        { header: 'Tipo', key: 'type', width: 11 },
        { header: 'Ubicación', key: 'location', width: 40 },
        { header: 'Motivo', key: 'reason', width: 36 },
        { header: 'Modo de marcación', key: 'markingMode', width: 20 },
        { header: 'Responsable', key: 'responsibleName', width: 26 },
        { header: 'Tamaño del grupo', key: 'groupSize', width: 16 },
        { header: 'ID de grupo', key: 'groupId', width: 24 },
        { header: 'Participante manual', key: 'manual', width: 18 },
        { header: 'Latitud', key: 'latitude', width: 14 },
        { header: 'Longitud', key: 'longitude', width: 14 },
        { header: 'Evidencia', key: 'evidence', width: 34 },
        { header: 'Formato foto', key: 'photoMimeType', width: 17 },
        { header: 'Tamaño foto (KB)', key: 'photoSizeKb', width: 18 },
        { header: 'Notas', key: 'notes', width: 30 },
      ];
      applyAttendanceHeaderStyle(detailSheet.getRow(1));
      sortedRecords.forEach((record) => {
        detailSheet.addRow({
          code: record?.code || '',
          date: formatAttendanceDate(record?.capturedAt ?? record?.createdAt),
          time: formatAttendanceTime(record?.capturedAt ?? record?.createdAt),
          userName: record?.userName || 'Usuario',
          role: record?.role || '',
          type: record?.type === 'salida' ? 'Salida' : 'Entrada',
          location: record?.location || '',
          reason: record?.reason || '',
          markingMode: record?.markingMode === 'responsable' ? 'Responsable / grupal' : 'Personal',
          responsibleName: record?.responsibleName || '',
          groupSize: record?.attendanceGroupSize || 1,
          groupId: record?.attendanceGroupId || '',
          manual: record?.isManualParticipant ? 'Sí' : 'No',
          latitude: record?.latitude ?? '',
          longitude: record?.longitude ?? '',
          evidence: getAttendanceEvidenceLabel(record),
          photoMimeType: record?.photoMimeType || '',
          photoSizeKb: record?.photoSizeBytes ? Number((Number(record.photoSizeBytes) / 1024).toFixed(1)) : '',
          notes: record?.notes || '',
        });
      });
      applyAttendanceDataBorders(detailSheet, 2, detailSheet.rowCount, 1, detailSheet.columnCount);
      detailSheet.getColumn('type').eachCell((cell, rowNumber) => {
        if (rowNumber === 1) return;
        const isExit = String(cell.value ?? '').toLowerCase() === 'salida';
        cell.font = { bold: true, color: { argb: isExit ? 'FFC2412D' : 'FF11834C' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      const dailyGroups = new Map();
      sortedRecords.forEach((record) => {
        const dateKey = getAttendanceDateKey(record?.capturedAt ?? record?.createdAt);
        const personKey = String(record?.userId || record?.userName || 'usuario').trim();
        const key = `${dateKey}|${personKey}`;
        if (!dailyGroups.has(key)) {
          dailyGroups.set(key, {
            dateKey,
            userName: record?.userName || 'Usuario',
            role: record?.role || '',
            records: [],
          });
        }
        dailyGroups.get(key).records.push(record);
      });

      const dailySheet = workbook.addWorksheet('Jornada por persona', {
        views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
        autoFilter: { from: 'A1', to: 'J1' },
      });
      dailySheet.columns = [
        { header: 'Fecha', key: 'date', width: 13 },
        { header: 'Usuario', key: 'userName', width: 28 },
        { header: 'Cargo / rol', key: 'role', width: 20 },
        { header: 'Primera entrada', key: 'firstEntry', width: 16 },
        { header: 'Última salida', key: 'lastExit', width: 16 },
        { header: 'Amplitud jornada', key: 'span', width: 17 },
        { header: 'Entradas', key: 'entries', width: 11 },
        { header: 'Salidas', key: 'exits', width: 11 },
        { header: 'Total marcas', key: 'marks', width: 13 },
        { header: 'Estado de marcación', key: 'status', width: 24 },
      ];
      applyAttendanceHeaderStyle(dailySheet.getRow(1));
      Array.from(dailyGroups.values())
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.userName.localeCompare(right.userName, 'es'))
        .forEach((group) => {
          const recordsByTime = group.records.slice().sort((left, right) => new Date(left?.capturedAt ?? left?.createdAt ?? 0) - new Date(right?.capturedAt ?? right?.createdAt ?? 0));
          const entries = recordsByTime.filter((record) => record?.type === 'entrada');
          const exits = recordsByTime.filter((record) => record?.type === 'salida');
          const firstEntry = entries[0];
          const lastExit = exits[exits.length - 1];
          const firstEntryMs = firstEntry ? new Date(firstEntry?.capturedAt ?? firstEntry?.createdAt ?? 0).getTime() : NaN;
          const lastExitMs = lastExit ? new Date(lastExit?.capturedAt ?? lastExit?.createdAt ?? 0).getTime() : NaN;
          const hasValidSpan = Number.isFinite(firstEntryMs) && Number.isFinite(lastExitMs) && lastExitMs >= firstEntryMs;
          let statusLabel = 'Completa';
          if (!entries.length && exits.length) statusLabel = 'Solo salida';
          else if (entries.length && !exits.length) statusLabel = 'Solo entrada';
          else if (!entries.length && !exits.length) statusLabel = 'Sin entrada/salida';
          else if (entries.length !== exits.length) statusLabel = 'Marcas desbalanceadas';
          else if (entries.length > 1 || exits.length > 1) statusLabel = 'Múltiples marcaciones';

          dailySheet.addRow({
            date: group.dateKey ? group.dateKey.split('-').reverse().join('/') : '',
            userName: group.userName,
            role: group.role,
            firstEntry: firstEntry ? formatAttendanceTime(firstEntry?.capturedAt ?? firstEntry?.createdAt) : '-',
            lastExit: lastExit ? formatAttendanceTime(lastExit?.capturedAt ?? lastExit?.createdAt) : '-',
            span: hasValidSpan ? formatAttendanceSpan((lastExitMs - firstEntryMs) / 60000) : '-',
            entries: entries.length,
            exits: exits.length,
            marks: recordsByTime.length,
            status: statusLabel,
          });
        });
      applyAttendanceDataBorders(dailySheet, 2, dailySheet.rowCount, 1, dailySheet.columnCount);
      dailySheet.getColumn('span').alignment = { vertical: 'middle', horizontal: 'center' };
      dailySheet.getColumn('entries').alignment = { vertical: 'middle', horizontal: 'center' };
      dailySheet.getColumn('exits').alignment = { vertical: 'middle', horizontal: 'center' };
      dailySheet.getColumn('marks').alignment = { vertical: 'middle', horizontal: 'center' };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const rangeLabel = `${filters.dateFrom || 'inicio'}_${filters.dateTo || 'fin'}`.replace(/[^0-9A-Za-z_-]+/g, '-');
      link.href = url;
      link.download = `asistencia-biometrica-${rangeLabel}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Reporte Excel generado con ${sortedRecords.length} marca${sortedRecords.length === 1 ? '' : 's'} visibles.`);
    } catch (exportError) {
      setError(exportError?.message || 'No se pudo generar el reporte Excel de asistencia.');
    } finally {
      setIsExportingAttendance(false);
    }
  };

  const selectableUsers = useMemo(
    () => users
      .filter((user) => !user?.deletedAt && String(user?.status ?? 'active') === 'active')
      .slice()
      .sort((a, b) => String(a?.fullName ?? a?.username ?? '').localeCompare(String(b?.fullName ?? b?.username ?? ''), 'es')),
    [users],
  );

  const filteredSelectableUsers = useMemo(() => {
    const query = normalizeText(participantQuery).trim();
    if (!query) return selectableUsers;
    return selectableUsers.filter((user) => normalizeText([
      user?.fullName,
      user?.username,
      user?.role,
    ].filter(Boolean).join(' ')).includes(query));
  }, [participantQuery, selectableUsers]);

  const selectedParticipants = useMemo(() => {
    const registered = selectedUserIds
      .map((userId) => selectableUsers.find((user) => String(user.id) === String(userId)))
      .filter(Boolean)
      .map((user) => ({
        userId: String(user.id),
        userName: String(user.fullName || user.username || 'Usuario').trim(),
        role: String(getUserDisplayRole(user) || 'Usuario').trim(),
        manual: false,
      }));
    const manual = manualParticipantNames.map((name) => ({
      userId: '',
      userName: name,
      role: 'Nombre manual',
      manual: true,
    }));
    return [...registered, ...manual];
  }, [manualParticipantNames, selectableUsers, selectedUserIds]);

  const toggleParticipantUser = (userId) => {
    setSelectedUserIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  };

  const addManualParticipant = () => {
    const name = String(manualParticipantDraft ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return;
    const normalizedName = normalizeText(name);
    const alreadyRegistered = selectedParticipants.some((participant) => normalizeText(participant.userName) === normalizedName);
    if (alreadyRegistered) {
      setError('Esa persona ya esta incluida en la marcacion grupal.');
      return;
    }
    setManualParticipantNames((current) => [...current, name]);
    setManualParticipantDraft('');
    setError('');
  };

  const handlePhotoChange = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError('');
    try {
      const processed = await compressAttendanceImage(file);
      setPhotoDraft((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return processed;
      });
      console.info('[copetin-attendance] Foto comprimida para asistencia.', {
        originalBytes: processed.originalSizeBytes,
        finalBytes: processed.sizeBytes,
        durationMs: processed.durationMs,
      });
    } catch (photoError) {
      setError(photoError.message || 'No se pudo cargar la foto.');
    } finally {
      // Permite volver a seleccionar/tomar la misma foto en Android/iPhone.
      input.value = '';
    }
  };


  const handleUseLocation = () => {
    setError('');
    setStatus('');
    if (!navigator.geolocation) {
      setError('Este dispositivo no permite capturar ubicación automática.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        const fallbackLocation = `${latitude}, ${longitude}`;
        let locationText = fallbackLocation;
        try {
          locationText = await resolveStreetAddress(latitude, longitude);
          setStatus('Ubicación capturada con calles. Puedes ajustarla manualmente si hace falta.');
        } catch {
          setStatus('GPS capturado como coordenadas. Si quieres, escribe manualmente la calle o referencia.');
        }
        setForm((current) => ({
          ...current,
          latitude,
          longitude,
          location: current.location || locationText,
        }));
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
        setError('No se pudo capturar la ubicación. Puedes escribirla manualmente.');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canMark) {
      setError('Tu usuario no tiene habilitada la marcación de asistencia.');
      return;
    }
    setError('');
    setStatus('');
    if (!photoDraft?.blob) {
      setError('Debes tomar o subir una foto para respaldar la marca.');
      return;
    }
    const participants = markingMode === 'responsable'
      ? selectedParticipants
      : [{
        userId: String(currentUser?.id ?? ''),
        userName: String(currentUser?.fullName || currentUser?.username || 'Usuario'),
        role: String(currentUser?.role || 'Usuario'),
        manual: false,
      }];
    if (markingMode === 'responsable' && participants.length === 0) {
      setError('Selecciona al menos un usuario o escribe el nombre de una persona.');
      return;
    }
    setIsSubmitting(true);
    try {
      const attendanceGroupId = markingMode === 'responsable'
        ? `attendance-group-${Date.now()}-${Math.random().toString(16).slice(2)}`
        : '';
      const uploadStartedAt = performance.now();
      const uploadedPhoto = await api.uploads.attendancePhoto(photoDraft.blob, {
        recordId: attendanceGroupId || `${currentUser?.id ?? 'attendance'}-${Date.now()}`,
      });
      console.info('[copetin-attendance] Foto de asistencia subida.', {
        originalBytes: photoDraft.originalSizeBytes,
        finalBytes: uploadedPhoto.bytes ?? photoDraft.sizeBytes,
        durationMs: Math.round(performance.now() - uploadStartedAt),
      });
      for (const participant of participants) {
        await onCreateRecord?.({
          ...form,
          markingMode,
          attendanceGroupId,
          attendanceGroupSize: participants.length,
          responsibleUserId: markingMode === 'responsable' ? String(currentUser?.id ?? '') : '',
          responsibleName: markingMode === 'responsable'
            ? String(currentUser?.fullName || currentUser?.username || 'Responsable')
            : '',
          groupMemberNames: participants.map((entry) => entry.userName),
          userId: participant.userId,
          userName: participant.userName,
          role: participant.role,
          isManualParticipant: participant.manual,
          photoUrl: uploadedPhoto.photoUrl,
          photoMimeType: uploadedPhoto.mimeType ?? photoDraft.mimeType,
          photoSizeBytes: uploadedPhoto.bytes ?? photoDraft.sizeBytes,
          photoWidth: photoDraft.width,
          photoHeight: photoDraft.height,
        });
      }
      setForm({
        type: 'entrada',
        location: '',
        reason: '',
        latitude: null,
        longitude: null,
      });
      setPhotoDraft((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return null;
      });
      setSelectedUserIds([]);
      setManualParticipantNames([]);
      setManualParticipantDraft('');
      setParticipantQuery('');
      setStatus(markingMode === 'responsable'
        ? `${participants.length} marcas registradas correctamente por el responsable.`
        : 'Marca registrada correctamente.');
    } catch (submitError) {
      setError(submitError.message || 'No se pudo registrar la asistencia.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel attendance-view">
      <header className="attendance-hero">
        <div>
          <span>Control remoto</span>
          <h2>Asistencia</h2>
          <p>Marca entrada o salida como biométrico móvil, con ubicación, motivo, hora y foto.</p>
        </div>
        <div className="attendance-user-card">
          <span className="attendance-user-avatar">{(currentUser?.fullName || currentUser?.username || 'U').slice(0, 1).toUpperCase()}</span>
          <strong>{currentUser?.fullName || currentUser?.username || 'Usuario'}</strong>
          <small>{currentUser?.role || 'Operador'}</small>
        </div>
      </header>

      <section className="attendance-kpis">
        <article>
          <small>Marcas de hoy</small>
          <strong>{todayRecords.length}</strong>
          <span>{getInputDate()}</span>
        </article>
        <article>
          <small>Entradas</small>
          <strong>{todayRecords.filter((record) => record.type === 'entrada').length}</strong>
          <span>Registradas hoy</span>
        </article>
        <article>
          <small>Salidas</small>
          <strong>{todayRecords.filter((record) => record.type === 'salida').length}</strong>
          <span>Registradas hoy</span>
        </article>
      </section>

      <section className="attendance-layout">
        <form className="attendance-card attendance-form" onSubmit={handleSubmit}>
          <div className="attendance-card-head">
            <div>
              <span>Biométrico móvil</span>
              <h3>
                {form.type === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}
                {markingMode === 'responsable' ? ' grupal' : ''}
              </h3>
            </div>
            <strong>{currentTimeLabel}</strong>
          </div>

          <article className={`attendance-punch-card ${form.type}`}>
            <span className="attendance-punch-ring" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3v9l5 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
            <div>
              <small>{todayLabel}</small>
              <strong>
                {markingMode === 'responsable'
                  ? `${form.type === 'entrada' ? 'Entrada' : 'Salida'} como responsable`
                  : form.type === 'entrada' ? 'Entrada del equipo' : 'Salida del equipo'}
              </strong>
              <p>
                {markingMode === 'responsable'
                  ? 'Una sola evidencia respaldará las marcas individuales de todas las personas seleccionadas.'
                  : 'La marca guardará usuario, fecha, hora, ubicación y evidencia.'}
              </p>
            </div>
          </article>

          {!canMark ? (
            <p className="status error">Tu usuario puede ver esta sección, pero no tiene habilitada la marcación.</p>
          ) : null}

          <div className="attendance-mode-panel">
            <span className="attendance-mode-label">Quién realiza la marcación</span>
            <div className="attendance-mode-toggle">
              <button
                type="button"
                className={markingMode === 'personal' ? 'active' : ''}
                onClick={() => setMarkingMode('personal')}
                disabled={!canMark}
              >
                Mi asistencia
              </button>
              <button
                type="button"
                className={markingMode === 'responsable' ? 'active' : ''}
                onClick={() => setMarkingMode('responsable')}
                disabled={!canMark}
              >
                Responsable
              </button>
            </div>
            <small>
              {markingMode === 'responsable'
                ? 'Selecciona a todas las personas cuya entrada o salida registrarás en conjunto.'
                : 'La marca se registrará solamente a nombre de tu usuario.'}
            </small>
          </div>

          {markingMode === 'responsable' ? (
            <section className="attendance-responsible-panel">
              <header>
                <span>
                  <strong>Personas de la marcación</strong>
                  <small>Usuarios registrados y nombres agregados manualmente.</small>
                </span>
                <b>{selectedParticipants.length} seleccionada(s)</b>
              </header>

              <label className="attendance-participant-search">
                Buscar usuarios
                <input
                  type="search"
                  value={participantQuery}
                  onChange={(event) => setParticipantQuery(event.target.value)}
                  placeholder="Buscar por nombre, usuario o rol..."
                />
              </label>

              <div className="attendance-participant-list">
                {filteredSelectableUsers.map((user) => {
                  const userId = String(user.id);
                  const userName = user.fullName || user.username || 'Usuario';
                  return (
                    <label key={userId} className={selectedUserIds.includes(userId) ? 'selected' : ''}>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(userId)}
                        onChange={() => toggleParticipantUser(userId)}
                      />
                      <span className="attendance-participant-avatar" aria-hidden="true">
                        {String(userName).trim().charAt(0).toUpperCase()}
                      </span>
                      <span>
                        <strong>{userName}</strong>
                        <small>{[user.username, getUserDisplayRole(user)].filter(Boolean).join(' · ') || 'Usuario registrado'}</small>
                      </span>
                    </label>
                  );
                })}
                {filteredSelectableUsers.length === 0 ? (
                  <p>{usersLoading ? 'Cargando usuarios...' : 'No se encontraron usuarios registrados.'}</p>
                ) : null}
              </div>

              <div className="attendance-manual-participant">
                <label>
                  Si la persona no tiene usuario
                  <input
                    value={manualParticipantDraft}
                    onChange={(event) => setManualParticipantDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addManualParticipant();
                      }
                    }}
                    placeholder="Escribe su nombre completo"
                  />
                </label>
                <button type="button" onClick={addManualParticipant}>+ Agregar nombre</button>
              </div>

              {manualParticipantNames.length > 0 ? (
                <div className="attendance-manual-chips">
                  {manualParticipantNames.map((name) => (
                    <span key={name}>
                      {name}
                      <button
                        type="button"
                        onClick={() => setManualParticipantNames((current) => current.filter((entry) => entry !== name))}
                        aria-label={`Quitar a ${name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="attendance-type-toggle">
            <button
              type="button"
              className={form.type === 'entrada' ? 'active' : ''}
              onClick={() => setForm((current) => ({ ...current, type: 'entrada' }))}
              disabled={!canMark}
            >
              Entrada
            </button>
            <button
              type="button"
              className={form.type === 'salida' ? 'active' : ''}
              onClick={() => setForm((current) => ({ ...current, type: 'salida' }))}
              disabled={!canMark}
            >
              Salida
            </button>
          </div>

          <label>
            Ubicación
            <div className="attendance-location-row">
              <input
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="Ej: Calle Bolívar y Sucre, salón, domicilio cliente, galpón..."
                required
              />
              <button type="button" onClick={handleUseLocation} disabled={isLocating || !canMark}>
                {isLocating ? 'Buscando...' : 'GPS'}
              </button>
            </div>
            <small className="attendance-field-hint">Puedes usar GPS para sugerir calles o escribir manualmente dónde estás.</small>
          </label>

          <label>
            Motivo
            <textarea
              rows={3}
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Ej: entrega temprana, salida tarde, apoyo en evento, visita a proveedor..."
              required
            />
          </label>

          <div className="attendance-photo-picker">
            <span className="attendance-photo-title">Evidencia fotográfica</span>

            {markingMode === 'responsable' && selectedParticipants.length > 1 ? (
              <div className="attendance-group-photo-advice">
                <strong>Foto grupal recomendada</strong>
                <span>
                  Incluye en la foto a las {selectedParticipants.length} personas seleccionadas para que la evidencia sea clara.
                </span>
              </div>
            ) : null}

            <div className="attendance-photo-native-grid">
              <div className="attendance-photo-native-box">
                <strong>📷 Tomar foto</strong>
                <small>Abre la cámara del celular.</small>
                <input
                  id="attendance-photo-camera-input"
                  className="attendance-photo-native-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  disabled={!canMark}
                  aria-label="Tomar foto con la cámara"
                />
              </div>

              <div className="attendance-photo-native-box">
                <strong>🖼️ Buscar foto</strong>
                <small>Selecciona una imagen guardada en el dispositivo.</small>
                <input
                  id="attendance-photo-gallery-input"
                  className="attendance-photo-native-input"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  disabled={!canMark}
                  aria-label="Buscar foto en galería o archivos"
                />
              </div>
            </div>

            {photoDraft ? (
              <small className="attendance-photo-ready">Foto preparada correctamente</small>
            ) : null}
          </div>

          {photoDraft?.previewUrl ? (
            <AttendancePhoto className="attendance-photo-preview" src={photoDraft.previewUrl} alt="Vista previa de asistencia" />
          ) : null}

          {error ? <p className="status error">{error}</p> : null}
          {status ? <p className="status success">{status}</p> : null}

          <button
            type="submit"
            className="attendance-submit"
            disabled={isSubmitting || !canMark || (markingMode === 'responsable' && selectedParticipants.length === 0)}
          >
            {isSubmitting
              ? markingMode === 'responsable' ? 'Registrando grupo...' : 'Registrando...'
              : markingMode === 'responsable'
                ? selectedParticipants.length > 0
                  ? `Registrar ${selectedParticipants.length} asistencia(s)`
                  : 'Selecciona personas'
                : 'Registrar asistencia'}
          </button>
        </form>

        <article className="attendance-card attendance-report">
          <div className="attendance-card-head">
            <div>
              <span>02 · Reporte</span>
              <h3>Marcas registradas</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <strong>{isReportLoading ? '…' : filteredRecords.length}</strong>
              <button
                type="button"
                className="ghost-button"
                onClick={exportAttendanceExcel}
                disabled={isExportingAttendance || isReportLoading || filteredRecords.length === 0}
                title="Generar reporte biométrico completo en Excel con los filtros visibles"
              >
                {isExportingAttendance ? 'Generando Excel...' : 'Generar Excel'}
              </button>
            </div>
          </div>

          <div className="attendance-filters">
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
            <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="all">Todas</option>
              <option value="entrada">Entradas</option>
              <option value="salida">Salidas</option>
            </select>
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Buscar usuario, motivo o ubicación"
            />
          </div>

          <div className="attendance-mobile-records">
            {filteredRecords.map((record) => {
              const photoSource = getAttendancePhotoSource(record);
              return (
              <article key={`mobile-${record.id}`} className="attendance-mobile-record">
                <div>
                  <strong>{record.userName}</strong>
                  <small>{formatDateTime ? formatDateTime(record.capturedAt) : record.capturedAt}</small>
                  {record.markingMode === 'responsable' ? (
                    <small className="attendance-responsible-record">Responsable: {record.responsibleName || 'Sin identificar'}</small>
                  ) : null}
                </div>
                <span className={`attendance-type ${record.type}`}>{record.type === 'entrada' ? 'Entrada' : 'Salida'}</span>
                <p>{record.location}</p>
                <small>{record.reason}</small>
                {photoSource ? (
                  <button
                    type="button"
                    className="attendance-mobile-photo-button"
                    onClick={() => setPhotoPreview({ src: photoSource, title: `${record.userName} · ${record.type === 'entrada' ? 'Entrada' : 'Salida'}` })}
                    aria-label={`Ver foto de asistencia de ${record.userName}`}
                  >
                    <AttendancePhoto src={photoSource} alt={`Foto de asistencia de ${record.userName}`} />
                    <span>Ver foto</span>
                  </button>
                ) : null}
              </article>
              );
            })}
            {filteredRecords.length === 0 ? (
              <p className="attendance-mobile-empty">Sin marcas en el rango seleccionado.</p>
            ) : null}
          </div>

          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Fecha y hora</th>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Ubicación / motivo</th>
                  <th>Foto</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const photoSource = getAttendancePhotoSource(record);
                  return (
                  <tr key={record.id}>
                    <td><strong>{record.code}</strong></td>
                    <td>{formatDateTime ? formatDateTime(record.capturedAt) : record.capturedAt}</td>
                    <td>
                      <strong>{record.userName}</strong>
                      <small>{record.role}</small>
                      {record.markingMode === 'responsable' ? (
                        <small className="attendance-responsible-record">
                          Grupo de {record.attendanceGroupSize || 1} · Responsable: {record.responsibleName || 'Sin identificar'}
                        </small>
                      ) : null}
                    </td>
                    <td><span className={`attendance-type ${record.type}`}>{record.type === 'entrada' ? 'Entrada' : 'Salida'}</span></td>
                    <td>
                      <strong>{record.location}</strong>
                      <small>{record.reason}</small>
                    </td>
                    <td>
                      {photoSource ? (
                        <button
                          type="button"
                          className="attendance-thumb-button"
                          onClick={() => setPhotoPreview({ src: photoSource, title: `${record.userName} · ${record.type === 'entrada' ? 'Entrada' : 'Salida'}` })}
                          aria-label={`Ver foto de asistencia de ${record.userName}`}
                        >
                          <AttendancePhoto className="attendance-thumb" src={photoSource} alt={`Foto de asistencia de ${record.userName}`} />
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                  );
                })}
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={6}><p className="status">Sin marcas en el rango seleccionado.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
      {photoPreview ? (
        <div className="attendance-photo-modal-backdrop" onClick={() => setPhotoPreview(null)}>
          <section className="attendance-photo-modal" onClick={(event) => event.stopPropagation()} aria-label="Vista previa de foto de asistencia">
            <header>
              <div>
                <span>Evidencia fotográfica</span>
                <h3>{photoPreview.title}</h3>
              </div>
              <button type="button" onClick={() => setPhotoPreview(null)} aria-label="Cerrar foto">×</button>
            </header>
            <AttendancePhoto src={photoPreview.src} alt={photoPreview.title} />
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default AttendanceSection;
