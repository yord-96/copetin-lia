export const contractServiceAppliesToGroup = (line, group) => line?.selected !== false
  && (!Array.isArray(line.variantIds) || !line.variantIds.length
    || line.variantIds.some(id => String(id) === String(group.variantId)));

export const selectedLincolnContractServices = (services = [], groups = []) => services.filter(line =>
  line && line.selected !== false && groups.some(group => contractServiceAppliesToGroup(line, group)));
