export async function loadPlanGroups(client) {
  const { data, error } = await client.from("plan_groups")
    .select("id,name,parent_group_id,sort_order,created_at,updated_at")
    .order("sort_order", { ascending: true }).order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
export async function createPlanGroup(client, userId, values) {
  const payload={user_id:userId,name:values.name.trim(),parent_group_id:values.parent_group_id||null,sort_order:Number(values.sort_order||0)};
  if(!payload.name) throw new Error("Group name is required.");
  const {data,error}=await client.from("plan_groups").insert(payload).select("id,name,parent_group_id,sort_order").single();
  if(error) throw error; return data;
}
export async function updatePlanGroup(client, groupId, values) {
  const payload={...values,updated_at:new Date().toISOString()};
  if("name" in payload){payload.name=payload.name.trim(); if(!payload.name) throw new Error("Group name is required.");}
  if("parent_group_id" in payload) payload.parent_group_id=payload.parent_group_id||null;
  const {data,error}=await client.from("plan_groups").update(payload).eq("id",groupId).select("id,name,parent_group_id,sort_order").single();
  if(error) throw error; return data;
}
export async function deletePlanGroup(client, groupId) {
  const {error}=await client.rpc("delete_plan_group",{p_group_id:groupId}); if(error) throw error;
}
export async function movePlanToGroup(client, planId, groupId) {
  const {error}=await client.from("plans").update({group_id:groupId||null,updated_at:new Date().toISOString()}).eq("id",planId);
  if(error) throw error;
}
export function descendantGroupIds(groups, groupId) {
  const result=new Set(), queue=[groupId];
  while(queue.length){const parent=queue.shift(); for(const group of groups){if(group.parent_group_id===parent&&!result.has(group.id)){result.add(group.id);queue.push(group.id);}}}
  return result;
}
export function validParentGroups(groups, groupId) {
  if(!groupId) return groups;
  const excluded=descendantGroupIds(groups,groupId); excluded.add(groupId);
  return groups.filter(group=>!excluded.has(group.id));
}
