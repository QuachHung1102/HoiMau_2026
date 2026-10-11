// Health and crisis-support copy: the one module to review before release.
//
// NOT REVIEWED BY A PROFESSIONAL (ruling R-D10, "chưa được chuyên gia duyệt"). It is written from the
// spec's formulas (sections 9.1 to 9.4) and general, conservative guidance only: no diagnosis, no
// promise of results, no calorie or weight target beyond what the spec defines. The phone numbers in
// CRISIS_LINES are Vietnam's public numbers and are flagged for review as well.
//
// CRISIS_KEYWORDS exist only so the journal screen can show the support block (S56). Matching runs on
// the device against the text the user just wrote; the text and the match result are never logged,
// stored or sent anywhere (AR-20).

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
      'Đây là ước tính hỗ trợ thói quen, không thay thế tư vấn của bác sĩ hoặc chuyên gia dinh dưỡng.',
    stats:
      'Các chỉ số chỉ để tham khảo tiến trình thói quen. Chúng không đo trực tiếp tình trạng sức khỏe.',
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

  // When macroAdjusted: the protein/fat/carb split used a fallback.
  macroAdjusted: {
    title: 'Vì sao phân bổ này?',
    body: 'Mình đã điều chỉnh nhẹ cách chia đạm, béo và carb để giữ mục tiêu năng lượng ở mức an toàn. Đây là ước tính, không phải chỉ định y tế. Nếu bạn cần tư vấn dinh dưỡng cá nhân, hãy trao đổi với chuyên gia.',
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
        body: 'Mục tiêu năng lượng không xuống dưới 1.200 kcal mỗi ngày với nữ, 1.500 kcal mỗi ngày với nam, và không thấp hơn mức năng lượng nghỉ của bạn. Mục tiêu cũng không thấp hơn quá 20% so với mức năng lượng bạn dùng mỗi ngày.',
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

// Already normalised with normalizeVi (lower case, no diacritics): compare against normalizeVi(text).
// Phrases only, never a single everyday word such as "mệt" or "chết đói".
export const CRISIS_KEYWORDS: readonly string[] = [
  'muon chet di',
  'toi muon chet',
  'minh muon chet',
  'em muon chet',
  'khong muon song nua',
  'khong con muon song',
  'khong muon tiep tuc song',
  'chan song',
  'het muon song',
  'khong thay ly do de song',
  'muon bien mat vinh vien',
  'muon ket thuc tat ca',
  'ket thuc cuoc song',
  'ket thuc cuoc doi',
  'ket thuc doi minh',
  'tu sat',
  'muon tu tu',
  'nghi den chuyen tu tu',
  'ket lieu ban than',
  'lam dau ban than',
  'tu lam dau minh',
  'se tot hon neu khong co toi',
  'la ganh nang cho moi nguoi',
];
