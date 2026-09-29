/**
 * presetDecks.js — 官方预设卡组（标准预设之外的“新版”）
 * 标准预设由卡牌库自动生成（见 deckStore.officialPresets）；这里放需要手工配的预设。
 * 每套都用 tools/balanceSim.mjs 做 AI 对战测胜率后再定稿。
 */
export const EXTRA_PRESETS = [
  {
    id: 'preset_wei_siege', name: '魏武军·攻城', kingdom: 'wei', mode: 'single',
    note: '霹雳车轰城，张郃、满宠、李通、臧霸补强前线，鸿门宴清点',
    cards: {
      wei_qing_qi_bing: 3, wei_hu_bao_qi: 2, wei_xu_chu: 1, wei_xia_hou_yuan: 1, wei_cheng_yu: 1, wei_cao_hong: 1,
      wei_yue_jin: 1, wei_yu_jin: 1, wei_xia_hou_dun: 1, wei_guo_jia: 1, wei_xu_huang: 1, wei_cao_cao: 1, wei_cao_ren: 1,
      wei_zhang_liao: 1, wei_li_dian: 1, wei_xun_yu: 1, wei_pang_de: 1,
      wei_pi_li_che: 2, wei_zhang_he: 1, wei_man_chong: 1, wei_li_tong: 1, wei_zang_ba: 1,
      wei_tian_zi_zhao_ling: 2, wei_shipo: 2, wei_shanjia: 2, wei_cefan: 2, wei_tuqi: 1, wei_tuchi: 2,
      wei_hong_men_yan: 2, wei_wang_mei_zhi_ke: 1
    }
  },
  {
    id: 'preset_shu_wolong', name: '蜀汉军·卧龙', kingdom: 'shu', mode: 'single',
    note: '诸葛亮、马超、黄忠、魏延领衔，发石车与火攻压制前线',
    cards: {
      shu_liu_bei: 1, shu_wang_ping: 1, shu_chen_dao: 1, shu_wu_ban: 1, shu_zhao_yun: 1, shu_zhang_fei: 1, shu_guan_yu: 1,
      shu_huang_quan: 1, shu_bai_er_jun: 3, shu_fu_tong: 1, shu_liao_hua: 1, shu_jian_yong: 1, shu_liu_feng: 1,
      shu_wu_dang_fei_jun: 3, shu_xu_shu: 1,
      shu_zhu_ge_liang: 1, shu_ma_chao: 1, shu_huang_zhong: 1, shu_wei_yan: 1, shu_fa_shi_che: 2, shu_lian_nu_ying: 2,
      shu_hao_jie_gui_xin: 2, shu_chong_zheng_qi_gu: 1, shu_shao_tun: 1, shu_shou_long: 2, shu_cefan: 2,
      shu_chengsheng: 1, shu_shipo: 1, shu_shanjia: 1, shu_huo_gong: 2
    }
  }
];
