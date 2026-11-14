export type Page = 'rules' | 'replay' | 'rings' | 'lists' | 'versions';

export const nav = $state({
  page: 'rules' as Page,
});
