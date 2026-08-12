export default function LinconIcon({ name }) {
  const paths = {
    panel: ['M4 5h16v14H4z', 'M4 10h16', 'M9 19v-9'],
    calendar: ['M7 3v4', 'M17 3v4', 'M4 8h16', 'M5 5h14v16H5z'],
    wallet: ['M4 7h16v12H4z', 'M16 12h4', 'M7 7V5h10v2'],
    bookmark: ['M6 4h12v17l-6-4-6 4z'],
    chart: ['M4 19V5', 'M8 16l3-4 4 2 5-7', 'M20 19H4'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
    home: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M9 20v-6h6v6'],
    bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7', 'M13.73 21a2 2 0 0 1-3.46 0'],
    star: ['M12 3l2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88z'],
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {(paths[name] ?? paths.panel).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
