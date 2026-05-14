export const toInputDate = (date) => {
  const clonedDate = new Date(date);
  clonedDate.setMinutes(clonedDate.getMinutes() - clonedDate.getTimezoneOffset());
  return clonedDate.toISOString().slice(0, 10);
};
