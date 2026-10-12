// All report loads, including background refreshes, share filters and ordering.
export function createAttendanceRecordLoader(fetchRecords, publish) {
  let filters = {};
  let request = 0;
  return {
    async load(nextFilters) {
      if (nextFilters !== undefined) filters = { ...nextFilters };
      const currentRequest = ++request;
      const records = await fetchRecords({ ...filters });
      if (currentRequest === request) publish(Array.isArray(records) ? records : []);
      return records;
    },
  };
}
