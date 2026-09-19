import assert from "node:assert/strict"; import { descendantGroupIds, validParentGroups } from "../plan-group-service.js";
const groups=[{id:"a",parent_group_id:null},{id:"b",parent_group_id:"a"},{id:"c",parent_group_id:"b"},{id:"d",parent_group_id:null}];
assert.deepEqual([...descendantGroupIds(groups,"a")].sort(),["b","c"]);
assert.deepEqual(validParentGroups(groups,"b").map(g=>g.id),["a","d"]);
assert.deepEqual(validParentGroups(groups,null).map(g=>g.id),["a","b","c","d"]);
console.log("Plan Group service tests passed");
