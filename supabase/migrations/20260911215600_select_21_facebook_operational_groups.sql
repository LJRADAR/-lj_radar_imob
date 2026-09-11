-- Operational Facebook group set: 21 active groups.
-- Scope: ABCD first, then high-signal Sao Paulo regional groups.

update public.lji_facebook_group_regions
set ativo = false;

update public.lji_facebook_group_regions
set ativo = true
where group_id in (
  'vlemeabc',
  '148029805397377',
  'classificadosdeimveisemdiademasp',
  'ClassificadosdeImoveisSaoBernardodoCampo',
  'alugarzonaleste',
  '1148705873556862',
  '1405730683009091',
  'CocaCityOficial',
  '946923359677488',
  '393926128050215',
  '3634004153395191',
  '289579589236564',
  '1845163145703712',
  '985134507000546',
  '392570390086329',
  '791581881394808',
  '580430898690342',
  '905967930243596',
  '867810226635635',
  '1546579022324228',
  '1197326061105340'
);
