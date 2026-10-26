// 平台参数分别维护，修改京东规则不会改变天猫口径。
export const JD_RULE = Object.freeze({
  version: "jd-2026-10-26-v8",
  caps: Object.freeze({ member: 50000, leader: 80000 }),
  defaultSubsidyRate: 10,
});
export const TMALL_RULE = Object.freeze({
  version: "tmall-legacy-v1",
  caps: Object.freeze({ member: 50000, leader: 80000 }),
});
