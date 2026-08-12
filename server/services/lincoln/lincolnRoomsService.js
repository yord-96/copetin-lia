import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const normalize = (value) => String(value ?? '').trim().toLowerCase();
const dateKey = (value) => String(value ?? '').slice(0, 10);
const todayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const addDays = (key, amount) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const normalizeImages = (room) => {
  const images = Array.isArray(room?.images)
    ? room.images
      .filter((image) => image && typeof image === 'object' && String(image.url ?? image.imageUrl ?? '').trim())
      .map((image) => ({
        url: String(image.url ?? image.imageUrl ?? '').trim(),
        filename: String(image.filename ?? '').trim(),
        mimeType: String(image.mimeType ?? '').trim(),
        bytes: Number(image.bytes ?? 0),
        uploadedAt: image.uploadedAt ?? image.createdAt ?? null,
      }))
    : [];
  const coverImageUrl = String(room?.coverImageUrl ?? images[0]?.url ?? '').trim();
  return { images, coverImageUrl };
};

export const getLincolnRoomsOverview = async ({ query = '', status = 'all' } = {}) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state ?? {};
  const rooms = Array.isArray(state.rooms) ? state.rooms : [];
  const events = Array.isArray(state.events) ? state.events : [];
  const normalizedQuery = normalize(query);
  const normalizedStatus = normalize(status || 'all');
  const today = todayKey();
  const horizon = addDays(today, 30);

  const rows = rooms
    .map((room) => {
      const roomEvents = events.filter((event) => (
        (String(event?.roomId ?? '') === String(room.id)
          || (!event?.roomId && normalize(event?.roomName) === normalize(room?.name)))
        && !['cancelled', 'completed'].includes(normalize(event?.status))
      ));
      const upcoming = roomEvents
        .filter((event) => dateKey(event.eventDate) >= today)
        .sort((a, b) => dateKey(a.eventDate).localeCompare(dateKey(b.eventDate)));
      const next30Days = upcoming.filter((event) => dateKey(event.eventDate) <= horizon);
      const { images, coverImageUrl } = normalizeImages(room);
      const active = normalize(room.status) !== 'inactive';

      return {
        id: room.id,
        code: room.code ?? '',
        name: room.name ?? '',
        capacity: Number(room.capacity ?? 0),
        status: active ? 'active' : 'inactive',
        description: room.description ?? '',
        coverImageUrl,
        images,
        imageCount: images.length,
        upcomingEvents: upcoming.length,
        eventsNext30Days: next30Days.length,
        nextEventDate: upcoming[0]?.eventDate ?? '',
        nextEventType: upcoming[0]?.eventType ?? '',
      };
    })
    .filter((row) => {
      if (normalizedStatus === 'active' && row.status !== 'active') return false;
      if (normalizedStatus === 'inactive' && row.status !== 'inactive') return false;
      if (!normalizedQuery) return true;
      return [row.code, row.name, row.description].some((value) => normalize(value).includes(normalizedQuery));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const activeRooms = rooms.filter((room) => normalize(room.status) !== 'inactive');
  const totalCapacity = activeRooms.reduce((total, room) => total + Number(room.capacity ?? 0), 0);
  const upcomingEvents = events.filter((event) => (
    dateKey(event.eventDate) >= today
    && !['cancelled', 'completed'].includes(normalize(event.status))
  ));
  const eventsNext30Days = upcomingEvents.filter((event) => dateKey(event.eventDate) <= horizon);

  return {
    revision: snapshot.revision,
    summary: {
      totalRooms: rooms.length,
      activeRooms: activeRooms.length,
      totalCapacity,
      upcomingEvents: upcomingEvents.length,
      eventsNext30Days: eventsNext30Days.length,
    },
    rows,
  };
};
