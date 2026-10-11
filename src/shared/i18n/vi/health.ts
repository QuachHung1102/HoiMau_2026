// Health and crisis-support copy: the one module to review before release.
//
// NOT REVIEWED BY A PROFESSIONAL (ruling R-D10, "chưa được chuyên gia duyệt"). It is written from the
// spec's formulas (sections 9.1 to 9.4) and general, conservative guidance only: no diagnosis, no
// promise of results, no calorie or weight target beyond what the spec defines. The phone numbers in
// CRISIS_LINES are Vietnam's public numbers and are flagged for review as well.
//
// CRISIS_KEYWORDS and CRISIS_PHRASES_EXACT exist only so the journal screen can show the support block
// (S56), through matchesCrisis in crisisMatch.ts. Matching runs on the device against the text the user
// just wrote; the text and the match result are never logged, stored or sent anywhere (AR-20).
// The lists trade false positives for recall: a false positive only shows a gentle support block, a miss
// shows nothing to someone who needed it. crisisMatch.test.ts holds the examples a reviewer should read:
// what must match, what must not, the accepted false positives and the known misses.
//
// How the lists are read (crisisMatch.ts): the text is split into clauses on . , ; : ! ? … and line breaks,
// and every clause is matched on its own, so a phrase split by punctuation ("tự... tử") never matches.
// Inside a clause an entry matches on word boundaries. An entry may start with ^ (the clause must begin
// with it) and/or end with $ (the clause must end with it); there is no other syntax. This is what
// separates "Muốn chết quá" (matches) from "Mệt muốn chết quá" (does not).

/** 1500 -> "1.500" (Hermes may lack Intl locale data, so no toLocaleString). */
const grouped = (n: number): string => {
  let rest = String(Math.round(n));
  let out = '';
  while (rest.length > 3) {
    out = `.${rest.slice(-3)}${out}`;
    rest = rest.slice(0, -3);
  }
  return rest + out;
};

export const healthVi = {
  // Section 9.2: shown at the end of onboarding and in settings.
  disclaimer:
    'Hồi Máu cung cấp ước tính dựa trên công thức dân số học phổ biến. Đây không phải tư vấn y tế cá nhân hóa và không thay thế ý kiến của bác sĩ hay chuyên gia dinh dưỡng.',

  // "Ước tính, không phải chẩn đoán": S08 (and S62), S47.
  estimate: {
    prescription:
      'Đây là ước tính, không phải chẩn đoán. Con số này hỗ trợ thói quen và không thay thế tư vấn của bác sĩ hoặc chuyên gia dinh dưỡng.',
    stats:
      'Các chỉ số chỉ để tham khảo tiến trình thói quen. Đây là ước tính, không phải chẩn đoán: chúng không đo trực tiếp tình trạng sức khỏe.',
  },

  // S62 and S08 when safetyClamped: the target was raised to the floor.
  safetyClamped: {
    title: 'Vì sao con số này?',
    chip: 'Đã điều chỉnh an toàn',
    body: (floorKcal: number) =>
      `Mục tiêu không xuống dưới mức nền ${grouped(
        floorKcal,
      )} kcal mỗi ngày. Đây là ước tính, không phải chỉ định y tế.`,
  },

  // When macroAdjusted: the energy target is unchanged, only the protein/fat/carb split was redone (R-D06).
  macroAdjusted: {
    title: 'Vì sao phân bổ này?',
    body: 'Mục tiêu năng lượng của bạn vẫn giữ nguyên; mình chỉ chia lại đạm, béo và carb để chất béo chiếm ít nhất 20% năng lượng và carb được giữ ở mức cao nhất có thể. Đây là ước tính, không phải chỉ định y tế. Nếu bạn cần tư vấn dinh dưỡng cá nhân, hãy trao đổi với chuyên gia.',
  },

  // S43: a reduce-fat profile is not applied; the two allowed directions are TANKER and SUPPORTER.
  blockedArchetype: {
    title: 'Chọn mục tiêu an toàn',
    subtitle: 'Cấu hình này chưa phù hợp với hồ sơ.',
    cardTitle: 'Mình ưu tiên sức khỏe của bạn',
    body: 'Mục tiêu giảm mỡ không được áp dụng cho hồ sơ này. Bạn có thể chọn hướng tăng sức mạnh hoặc cân bằng.',
    footer:
      'Hãy trao đổi với chuyên gia nếu bạn cần tư vấn dinh dưỡng cá nhân.',
    directions: [
      { archetype: 'TANKER', label: 'Tăng sức mạnh' },
      { archetype: 'SUPPORTER', label: 'Cân bằng' },
    ],
  },

  // S61: nobody is blamed.
  under16: {
    title: 'Hồi Máu dành cho người từ 16 tuổi',
    body: 'Mục tiêu năng lượng trong ứng dụng được tính cho người trưởng thành. Khi đủ tuổi, bạn luôn có thể quay lại.',
  },

  workoutCaution:
    'Dừng nếu thấy đau hoặc khó chịu. Bạn luôn có thể nghỉ hoặc kết thúc sớm.',

  // S53 "Thông tin sức khỏe".
  info: {
    title: 'Thông tin sức khỏe',
    paragraphs: [
      {
        title: 'Ước tính, không phải chẩn đoán',
        body: 'Mục tiêu năng lượng và nước được tính từ chiều cao, cân nặng, tuổi, giới tính và mức vận động của bạn, theo công thức dân số học phổ biến. Đây là ước tính, không phải chẩn đoán hay tư vấn y tế cá nhân.',
      },
      {
        title: 'Mức nền an toàn',
        body: 'Mục tiêu năng lượng không xuống dưới 1.200 kcal mỗi ngày với nữ, 1.500 kcal mỗi ngày với nam, và không thấp hơn mức năng lượng nghỉ của bạn. Mục tiêu cũng thấp hơn mức năng lượng bạn dùng mỗi ngày không quá 20%.',
      },
      {
        title: 'Cân nặng chỉ là đầu vào',
        body: 'Hồi Máu không yêu cầu cân hằng ngày và không thưởng cho việc giảm cân. Cân nặng chỉ dùng để tính năng lượng.',
      },
      {
        title: 'Chỉ số nhân vật',
        body: 'Sức sống, năng lượng, sức mạnh và sức bền phản ánh hành vi bạn đã ghi nhận, không đánh giá con người và không đo trực tiếp tình trạng sức khỏe.',
      },
      {
        title: 'Khi nào nên hỏi chuyên gia',
        body: 'Nếu bạn có bệnh nền, đang mang thai hoặc cho con bú, đang dùng thuốc, hoặc thấy không khỏe, hãy trao đổi với bác sĩ hoặc chuyên gia dinh dưỡng trước khi thay đổi cách ăn hoặc cách tập.',
      },
      {
        title: 'Độ tuổi',
        body: 'Hồi Máu dành cho người từ 16 tuổi.',
      },
    ],
  },

  // S56: shown beside the normal journal response, never instead of it.
  support: {
    title: 'Bạn không cần ở một mình',
    subtitle: 'Một lời nhắc bên cạnh trang nhật ký.',
    cardTitle: 'Tìm một người có thể lắng nghe',
    body: 'Nếu muốn, bạn có thể liên hệ một người mình tin tưởng hoặc tìm dịch vụ hỗ trợ tại nơi bạn sống.',
    seeSources: 'Xem nguồn hỗ trợ',
    backToJournal: 'Trở lại trang của tôi',
    footer: 'Bạn có thể quay lại nhật ký bất cứ lúc nào.',
    sourcesTitle: 'Nguồn hỗ trợ',
    sourcesIntro:
      'Đây là các số điện thoại công cộng tại Việt Nam. Chạm vào một số để gọi.',
    urgent: 'Nếu bạn hoặc ai đó đang gặp nguy hiểm ngay lúc này, hãy gọi 115.',
    callLabel: (number: string) => `Gọi ${number}`,
  },
} as const;

export const CRISIS_LINES = [
  { number: '115', label: 'Cấp cứu' },
  { number: '111', label: 'Tổng đài quốc gia bảo vệ trẻ em' },
] as const;

// First-person words that may precede a direct statement (toi = tôi, minh = mình, chau = cháu, ...).
const SELF = ['minh', 'em', 'chau', 'tao', 'tui', 'anh', 'chi'];

// Pronouns whose toneless form collides with an everyday word: tôi / tới / tối, còn / con, tớ / to.
// Their phrases are tier B entries, in the accented spelling and in raw ASCII.
const TONED_SELF: readonly (readonly [string, string])[] = [
  ['tôi', 'toi'],
  ['con', 'con'],
  ['tớ', 'to'],
];

// Tier A, tone-insensitive: already normalised with normalizeVi (lower case, no diacritics) apart from the
// ^ and $ anchors, and matched against the normalised clause, so a phrase also matches when typed without
// diacritics. Phrases only, never a single everyday word ("mệt", "chết đói"). Left out on purpose because
// they fire on routine writing once tones are gone or the idiom is a suffix: bare and suffix forms of
// "muon chet" (mệt/đói/đau muốn chết), "tu tu" (từ từ), "tu van" (tư vấn), "ngu mai khong day" (ngủ mãi
// không dậy nổi), "uong het lo thuoc" (lọ thuốc ho), "nhay lau" (nhảy lâu hơn), "chan song" (chân sống lưng),
// "rach tay" (rách tay áo), "cat tay" (cắt tay áo), "het chiu noi" (nóng hết chịu nổi), bare "khong tinh day
// nua" and "khong thuc day nua" (sleep tracking: ngủ ngon, không tỉnh dậy nữa giữa đêm), "muon buong xuoi",
// "uong ca vi thuoc" (a course of antibiotics). "toi", "con" and "to" as speaker are tier B (see there).
export const CRISIS_KEYWORDS: readonly string[] = [
  // wanting to die: clause-initial, or after a first-person word, or with an intent continuation
  '^muon chet',
  ...SELF.map(who => `${who} muon chet`),
  'tha chet',
  'chet quach',
  'chet di cho',
  'chet cho roi',
  'chet cho xong',
  'muon duoc chet',
  'chet di thi',
  'chet di moi nguoi',
  'chet di cung khong ai',
  'uoc gi minh chet',
  'uoc gi toi chet',
  'that su muon chet',
  'thuc su muon chet',
  'lai muon chet',
  'doi khi muon chet',
  'thinh thoang muon chet',
  'luc nao cung muon chet',
  '^gio muon chet',
  // not wanting to live, no way out
  'khong muon song',
  'chang muon song',
  'khong con muon song',
  'chang con muon song',
  'khong muon tiep tuc song',
  'het muon song',
  'muon dung song',
  'khong thiet song',
  'chang thiet song',
  'chan song qua',
  'chan song roi',
  'chan song nua',
  'minh chan song',
  'khong con ly do de song',
  'khong thay ly do de song',
  'song de lam gi',
  'song chang con y nghia',
  'song khong con y nghia',
  'doi nay khong con gi',
  'doi nay chang con gi',
  'khong muon ton tai',
  'khong con loi thoat',
  'chang con loi thoat',
  'khong con duong thoat',
  'buong xuoi tat ca',
  '^het chiu noi$',
  '^het chiu noi roi$',
  ...SELF.flatMap(who => [`${who} het chiu noi$`, `${who} het chiu noi roi$`]),
  // hoping not to wake up, disappearing
  'gia nhu minh khong tinh day',
  'gia nhu toi khong tinh day',
  'uoc gi minh khong tinh day',
  'uoc gi toi khong tinh day',
  'khong muon tinh day nua',
  'muon ngu mai mai',
  'muon ngu mai khong day nua',
  'muon ngu mai khong tinh',
  'khong bao gio day nua',
  'dung bao gio day nua',
  'khong bao gio tinh lai',
  'dung bao gio tinh lai',
  'khong bao gio tinh day nua',
  'muon bien mat',
  'bien mat khoi the gioi',
  'bien mat khoi cuoc doi',
  'bien mat vinh vien',
  // ending it
  'tu sat',
  'ket lieu doi',
  'ket lieu ban than',
  'ket lieu cuoc song',
  'ket lieu minh',
  'ket thuc cuoc song',
  'ket thuc cuoc doi',
  'ket thuc doi minh',
  'muon ket thuc tat ca',
  'nhay tu tang',
  'muon nhay cau',
  'muon nhay xuong bien',
  'nhay xuong song',
  // harming oneself
  'hay cat tay',
  'lai cat tay',
  'tu cat tay',
  'tu cat vao tay',
  'muon cat tay',
  'cat tay de',
  'cat tay minh',
  'minh cat tay$',
  'toi cat tay$',
  'em cat tay$',
  'cat co tay',
  'cua vao tay',
  'hay rach tay',
  'lai rach tay',
  'tu rach tay',
  'muon rach tay',
  'rach co tay',
  'tu lam dau ban than',
  'tu lam dau minh',
  'tu lam minh dau',
  'tu lam hai ban than',
  'tu lam hai minh',
  'muon lam dau ban than',
  'muon lam dau minh',
  // means named, or intent stated
  'uong thuoc ngu cho het',
  'uong thuoc ngu het lo',
  'uong thuoc ngu that nhieu',
  'thuoc ngu de chet',
  'uong thuoc de chet',
  'uong het thuoc ngu',
  'uong ca vi thuoc ngu',
  'uong thuoc diet co',
  'uong thuoc tru sau',
  'uong thuoc chuot',
  // feeling like a burden
  'se tot hon neu khong co toi',
  'se tot hon neu khong co minh',
  'khong co toi se tot hon',
  'la ganh nang cho moi nguoi',
  'la ganh nang cho gia dinh',
  'la ganh nang cua gia dinh',
];

// Tier B, tone-sensitive: compared with the NFC lower-case clause, so accented "muốn từ từ" and "tư vấn"
// can never match. Accented entries are words that collide with everyday ones once tones are stripped
// (tự tử / từ từ, tự vẫn / tư vấn, nhảy lầu / nhảy lâu, treo cổ / treo cờ, đáng sống / đang sống). The
// raw-ASCII entries are intent phrases for people who type without diacritics; "tu tu" there needs a clause
// end or an unambiguous continuation, because "muon tu tu giam can" is the everyday "từ từ". The
// first-person phrases with tôi, con and tớ are here too (TONED_SELF): toneless "toi" is also tới and
// tối ("mệt tới muốn chết"), "con" is còn, "to" is the adjective ("to muốn chết"). Only text typed fully
// without diacritics can still fire on them.
export const CRISIS_PHRASES_EXACT: readonly string[] = [
  ...TONED_SELF.flatMap(([accented, ascii]) => [
    `${accented} muốn chết`,
    `${ascii} muon chet`,
    `${accented} hết chịu nổi$`,
    `${accented} hết chịu nổi rồi$`,
    `${ascii} het chiu noi$`,
    `${ascii} het chiu noi roi$`,
  ]),
  'tôi chán sống',
  'toi chan song',
  'cho tôi chết đi',
  'cho toi chet di',
  'tự tử',
  'tự vẫn',
  'nhảy lầu',
  'treo cổ',
  'cứa tay',
  'cứa cổ tay',
  'không đáng sống',
  'chẳng đáng sống',
  'không xứng đáng sống',
  'muon tu tu$',
  'dinh tu tu$',
  'se tu tu$',
  'y dinh tu tu',
  'nghi den tu tu',
  'nghi toi tu tu',
  'nghi den chuyen tu tu',
  'tu tu cho xong',
  'tu tu de giai thoat',
  'muon treo co',
  'nhay lau tu tang',
  'muon nhay lau',
  'dinh nhay lau',
  'khong dang song nua',
  'thay minh khong dang song',
  'khong xung dang song',
];
