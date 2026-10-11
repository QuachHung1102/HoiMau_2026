import type { MealSeed } from './types.ts';

// Meal library for the daily plan (spec F-04). NOT reviewed by a nutrition professional (R-D10):
// kcal and macros are plausible estimates for the stated household portion, consistent by
// 4 x protein + 4 x carbs + 9 x fat, and must not be shown as exact values.
// Ingredient tags drive the user's exclusion filter (S15), so they are honest: a dish carries a tag
// when its text names the ingredient or its standard recipe contains it, seasonings included
// (nước mắm, mắm tôm, mắm ruốc and dầu hào count as `co:hai-san`; nước tương and tương as
// `co:dau-nanh`), and the text then names the reason. Tree nuts and sesame have no tag in the
// vocabulary, so the filter is not an allergy guarantee.
// Tag meanings: `co:thit-do` = pork, beef, other red meat; `co:gia-cam` = chicken, duck.
// `khong-thit` = no meat, poultry, seafood or fish sauce; `chay` = also no egg and no dairy.
// `it-nau` = needs little or no cooking; `ngoai-hang` = easy to buy ready-made outside.
// Rice carbs: cooked rice is about 0.28 g carbs per gram.
export const MEALS: MealSeed[] = [
  // ---------------------------------------------------------------- BREAKFAST
  {
    code: 'YEN_MACH_TRAI_CAY',
    name: 'Yến mạch và trái cây',
    mealSlot: 'BREAKFAST',
    kcal: 540,
    proteinG: 19,
    carbsG: 78,
    fatG: 17,
    tags: ['khong-thit', 'it-nau', 'co:sua', 'co:gluten'],
    portionText:
      '1 tô (khoảng 400 g): 60 g yến mạch nấu với 200 ml sữa tươi, 120 g chuối hoặc trái cây theo mùa, 15 g hạt.',
    description:
      'Yến mạch nấu mềm với sữa, thêm trái cây thái miếng và một ít hạt. Chuẩn bị nhanh vào buổi sáng bận rộn.',
    imageKey: 'e1ZpZ',
  },
  {
    code: 'PHO_BO',
    name: 'Phở bò',
    mealSlot: 'BREAKFAST',
    kcal: 470,
    proteinG: 26,
    carbsG: 65,
    fatG: 12,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 tô vừa (khoảng 450 g): 150 g bánh phở, 60 g thịt bò thái mỏng, 240 ml nước dùng, hành và rau thơm.',
    description:
      'Bánh phở với thịt bò thái mỏng trong nước dùng nêm nước mắm, ăn kèm rau thơm. Dễ gặp ở hầu hết các quán sáng.',
    imageKey: null,
  },
  {
    code: 'PHO_GA',
    name: 'Phở gà',
    mealSlot: 'BREAKFAST',
    kcal: 415,
    proteinG: 24,
    carbsG: 62,
    fatG: 8,
    tags: ['ngoai-hang', 'co:gia-cam', 'co:hai-san'],
    portionText:
      '1 tô vừa (khoảng 450 g): 150 g bánh phở, 70 g thịt gà xé, 230 ml nước dùng, hành lá và rau thơm.',
    description:
      'Bánh phở với thịt gà xé trong nước dùng trong, nêm nước mắm, thêm chanh và rau thơm theo khẩu vị.',
    imageKey: null,
  },
  {
    code: 'PHO_CHAY',
    name: 'Phở chay nấm đậu hũ',
    mealSlot: 'BREAKFAST',
    kcal: 385,
    proteinG: 16,
    carbsG: 62,
    fatG: 8,
    tags: ['chay', 'khong-thit', 'ngoai-hang', 'co:dau-nanh'],
    portionText:
      '1 tô vừa (khoảng 550 g): 150 g bánh phở, 80 g đậu hũ, 60 g nấm, 30 g rau cải, 230 ml nước dùng rau củ.',
    description:
      'Nước dùng nấu từ rau củ, bánh phở với đậu hũ chiên và nấm. Món sáng không dùng thịt, cá hay trứng.',
    imageKey: null,
  },
  {
    code: 'BANH_MI_OP_LA',
    name: 'Bánh mì ốp la',
    mealSlot: 'BREAKFAST',
    kcal: 405,
    proteinG: 19,
    carbsG: 44,
    fatG: 17,
    tags: [
      'khong-thit',
      'it-nau',
      'ngoai-hang',
      'co:trung',
      'co:gluten',
      'co:dau-nanh',
    ],
    portionText:
      '1 phần (khoảng 250 g): 1 ổ bánh mì 80 g, 2 quả trứng ốp la (khoảng 100 g), 50 g dưa leo, 20 g rau thơm.',
    description:
      'Ổ bánh mì giòn với trứng ốp la còn lòng đào, thêm dưa leo và chút nước tương hoặc tiêu.',
    imageKey: null,
  },
  {
    code: 'XOI_GA_XE',
    name: 'Xôi gà xé',
    mealSlot: 'BREAKFAST',
    kcal: 495,
    proteinG: 24,
    carbsG: 68,
    fatG: 14,
    tags: ['ngoai-hang', 'co:gia-cam'],
    portionText:
      '1 phần (khoảng 320 g): 250 g xôi, 60 g thịt gà xé, 10 g hành phi.',
    description:
      'Xôi nếp dẻo ăn cùng gà xé và hành phi, gói gọn để ăn trên đường đi làm.',
    imageKey: null,
  },
  {
    code: 'BANH_CUON_NHAN_THIT',
    name: 'Bánh cuốn nhân thịt',
    mealSlot: 'BREAKFAST',
    kcal: 400,
    proteinG: 18,
    carbsG: 55,
    fatG: 12,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 đĩa (khoảng 220 g): 190 g bánh cuốn (6 đến 8 cái) nhân thịt heo và mộc nhĩ, 10 g hành phi, 20 g rau sống.',
    description:
      'Bánh cuốn mỏng, nóng, nhân thịt heo băm và mộc nhĩ, chấm nước mắm pha loãng.',
    imageKey: null,
  },
  {
    code: 'CHAO_TRUNG_THIT_BAM',
    name: 'Cháo trứng thịt bằm',
    mealSlot: 'BREAKFAST',
    kcal: 350,
    proteinG: 18,
    carbsG: 45,
    fatG: 11,
    tags: ['co:trung', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 tô (khoảng 400 g): cháo nấu từ 60 g gạo (khoảng 300 g cháo), 40 g thịt heo bằm, 1 quả trứng (khoảng 50 g), hành lá.',
    description:
      'Cháo gạo nấu nhừ với thịt heo bằm, nêm nước mắm, đập thêm một quả trứng khi cháo còn nóng.',
    imageKey: null,
  },
  {
    code: 'CHAO_GA',
    name: 'Cháo gà',
    mealSlot: 'BREAKFAST',
    kcal: 325,
    proteinG: 20,
    carbsG: 45,
    fatG: 7,
    tags: ['ngoai-hang', 'co:gia-cam', 'co:hai-san'],
    portionText:
      '1 tô (khoảng 400 g): cháo nấu từ 60 g gạo (khoảng 320 g cháo), 70 g thịt gà xé, hành lá, gừng sợi.',
    description:
      'Cháo gạo nấu với nước luộc gà, nêm nước mắm, thêm gà xé, gừng sợi và hành lá. Nhẹ và ấm bụng.',
    imageKey: null,
  },
  {
    code: 'HU_TIEU_NAM_VANG',
    name: 'Hủ tiếu Nam Vang',
    mealSlot: 'BREAKFAST',
    kcal: 460,
    proteinG: 24,
    carbsG: 60,
    fatG: 14,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 tô vừa (khoảng 450 g): 150 g hủ tiếu, 40 g thịt heo, 3 con tôm (40 g), 30 g giá và hẹ, 190 ml nước dùng.',
    description:
      'Hủ tiếu trong nước dùng ngọt thanh với thịt heo, tôm và giá, thêm chút tỏi phi.',
    imageKey: null,
  },
  {
    code: 'XOI_LAC_MUOI_VUNG',
    name: 'Xôi đậu phộng muối vừng',
    mealSlot: 'BREAKFAST',
    kcal: 370,
    proteinG: 10,
    carbsG: 58,
    fatG: 11,
    tags: ['chay', 'khong-thit', 'ngoai-hang', 'co:dau-phong'],
    portionText:
      '1 gói nhỏ (khoảng 220 g): 200 g xôi, 20 g đậu phộng rang, 1 muỗng cà phê muối vừng.',
    description:
      'Xôi nếp nấu cùng đậu phộng, rắc muối vừng. Gọn, dễ mang theo và không cần thêm món ăn kèm.',
    imageKey: null,
  },
  {
    code: 'BUN_BO_HUE',
    name: 'Bún bò Huế',
    mealSlot: 'BREAKFAST',
    kcal: 625,
    proteinG: 32,
    carbsG: 75,
    fatG: 22,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 tô lớn (khoảng 600 g): 200 g bún, 80 g thịt bò và giò, 20 g rau sống, 300 ml nước dùng sả.',
    description:
      'Bún sợi to trong nước dùng sả đậm vị, nêm mắm ruốc, ăn với thịt bò, giò và rau sống.',
    imageKey: null,
  },
  {
    code: 'XOI_MAN_THAP_CAM',
    name: 'Xôi mặn thập cẩm',
    mealSlot: 'BREAKFAST',
    kcal: 695,
    proteinG: 30,
    carbsG: 88,
    fatG: 25,
    tags: ['ngoai-hang', 'co:thit-do', 'co:trung', 'co:hai-san'],
    portionText:
      '1 phần lớn (khoảng 410 g): 300 g xôi, 50 g thịt heo kho, 3 quả trứng cút (30 g), 20 g chà bông, 10 g hành phi.',
    description:
      'Xôi nếp với thịt heo kho nêm nước mắm, trứng cút và chà bông. Một phần đầy đặn cho buổi sáng nhiều việc.',
    imageKey: null,
  },
  {
    code: 'BANH_MI_CHAO',
    name: 'Bánh mì chảo',
    mealSlot: 'BREAKFAST',
    kcal: 735,
    proteinG: 31,
    carbsG: 68,
    fatG: 38,
    tags: ['ngoai-hang', 'co:thit-do', 'co:trung', 'co:gluten'],
    portionText:
      '1 chảo (khoảng 360 g): 1 ổ bánh mì 100 g, 2 quả trứng ốp la (khoảng 100 g), 1 cây xúc xích 50 g, 80 g đậu sốt cà chua, 30 g rau.',
    description:
      'Trứng ốp la, xúc xích và đậu sốt cà chua dọn trong chảo nóng, ăn cùng ổ bánh mì.',
    imageKey: null,
  },
  {
    code: 'BANH_KEP_CHUOI_TRUNG',
    name: 'Bánh kếp chuối trứng',
    mealSlot: 'BREAKFAST',
    kcal: 660,
    proteinG: 26,
    carbsG: 89,
    fatG: 22,
    tags: ['khong-thit', 'co:trung', 'co:sua', 'co:gluten'],
    portionText:
      '3 cái bánh (khoảng 425 g): 2 quả trứng (100 g), 120 g chuối chín, 50 g bột mì, 30 g yến mạch, 120 ml sữa tươi, 5 g dầu ăn.',
    description:
      'Bánh kếp mềm làm từ trứng, chuối, bột mì và yến mạch, áp chảo trên chảo chống dính.',
    imageKey: null,
  },

  // ------------------------------------------------------------------- LUNCH
  {
    code: 'COM_GA_RAU_CU',
    name: 'Cơm gà, rau củ',
    mealSlot: 'LUNCH',
    kcal: 820,
    proteinG: 50,
    carbsG: 100,
    fatG: 24,
    tags: ['ngoai-hang', 'co:gia-cam'],
    portionText:
      '1 phần khoảng 550 g: 330 g cơm (khoảng 2 chén), 160 g thịt đùi gà nướng, 60 g rau củ theo mùa.',
    description:
      'Cơm trắng với thịt gà nướng và rau củ theo mùa, một bữa trưa quen thuộc.',
    imageKey: 'Fr7yg',
  },
  {
    code: 'COM_CA_RAU_LUOC',
    name: 'Cơm cá và rau luộc',
    mealSlot: 'LUNCH',
    kcal: 790,
    proteinG: 42,
    carbsG: 105,
    fatG: 20,
    tags: ['co:hai-san'],
    portionText:
      '1 phần khoảng 580 g: 330 g cơm (khoảng 2 chén), 1 khúc cá chiên hoặc kho (khoảng 150 g), 100 g rau luộc.',
    description:
      'Cơm trắng với một khúc cá và đĩa rau luộc chấm nước mắm gừng.',
    imageKey: null,
  },
  {
    code: 'BUN_GA_RAU_THOM',
    name: 'Bún gà rau thơm',
    mealSlot: 'LUNCH',
    kcal: 760,
    proteinG: 40,
    carbsG: 95,
    fatG: 22,
    tags: ['ngoai-hang', 'co:gia-cam', 'co:hai-san', 'co:dau-phong'],
    portionText:
      '1 tô lớn (khoảng 430 g): 200 g bún tươi, 100 g thịt gà xé, 60 g rau thơm, 20 g đậu phộng giã, 50 ml nước mắm chua ngọt.',
    description:
      'Bún tươi trộn gà xé và nhiều rau thơm, rưới nước mắm chua ngọt.',
    imageKey: null,
  },
  {
    code: 'DAU_HU_COM_NAM',
    name: 'Đậu hũ, cơm và nấm',
    mealSlot: 'LUNCH',
    kcal: 745,
    proteinG: 32,
    carbsG: 100,
    fatG: 24,
    tags: ['chay', 'khong-thit', 'co:dau-nanh'],
    portionText:
      '1 phần khoảng 600 g: 300 g cơm (khoảng 2 chén), 150 g đậu hũ chiên, 80 g nấm xào, 70 g rau cải.',
    description:
      'Đậu hũ chiên vàng om cùng nấm, ăn với cơm trắng và rau xanh. Món không dùng thịt, cá hay trứng.',
    imageKey: null,
  },
  {
    code: 'BUN_CHA_HA_NOI',
    name: 'Bún chả',
    mealSlot: 'LUNCH',
    kcal: 680,
    proteinG: 34,
    carbsG: 78,
    fatG: 26,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 550 g): 200 g bún, 100 g chả nướng và thịt nướng, 150 ml nước chấm, 100 g rau sống.',
    description:
      'Chả và thịt heo nướng thơm, chấm nước mắm chua ngọt, ăn cùng bún và rau sống.',
    imageKey: null,
  },
  {
    code: 'COM_TAM_SUON_TRUNG',
    name: 'Cơm tấm sườn trứng',
    mealSlot: 'LUNCH',
    kcal: 865,
    proteinG: 40,
    carbsG: 100,
    fatG: 34,
    tags: ['ngoai-hang', 'co:thit-do', 'co:trung', 'co:hai-san'],
    portionText:
      '1 đĩa (khoảng 580 g): 330 g cơm tấm, 100 g sườn nướng, 1 quả trứng ốp la (50 g), 70 g đồ chua và dưa leo, 30 ml nước mắm pha sẵn.',
    description:
      'Cơm tấm với sườn nướng, trứng ốp la, đồ chua và nước mắm pha sẵn.',
    imageKey: null,
  },
  {
    code: 'COM_THIT_KHO_TRUNG',
    name: 'Cơm thịt kho trứng',
    mealSlot: 'LUNCH',
    kcal: 840,
    proteinG: 38,
    carbsG: 98,
    fatG: 33,
    tags: ['co:thit-do', 'co:trung', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 710 g): 330 g cơm, 80 g thịt ba chỉ kho, 2 quả trứng kho (100 g), 200 ml canh rau.',
    description:
      'Thịt heo và trứng kho với nước mắm và nước dừa, ăn với cơm nóng và một bát canh rau.',
    imageKey: null,
  },
  {
    code: 'MI_QUANG',
    name: 'Mì Quảng',
    mealSlot: 'LUNCH',
    kcal: 675,
    proteinG: 34,
    carbsG: 85,
    fatG: 22,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san', 'co:dau-phong'],
    portionText:
      '1 tô (khoảng 500 g): 200 g mì gạo, 3 con tôm (40 g), 50 g thịt heo, 100 ml nước dùng, 20 g đậu phộng rang, 20 g bánh tráng, 70 g rau sống.',
    description:
      'Mì gạo sợi to trộn ít nước dùng đậm vị cùng tôm, thịt heo, đậu phộng và rau sống.',
    imageKey: null,
  },
  {
    code: 'BUN_RIEU_CUA',
    name: 'Bún riêu cua',
    mealSlot: 'LUNCH',
    kcal: 530,
    proteinG: 28,
    carbsG: 66,
    fatG: 17,
    tags: ['ngoai-hang', 'co:hai-san', 'co:trung', 'co:dau-nanh'],
    portionText:
      '1 tô (khoảng 550 g): 150 g bún, 120 g riêu cua nấu với trứng, 2 miếng đậu hũ chiên (60 g), 40 g cà chua, 30 g rau sống, 150 ml nước dùng.',
    description:
      'Bún trong nước dùng cà chua với riêu cua nấu cùng trứng và đậu hũ chiên, ăn kèm rau sống.',
    imageKey: null,
  },
  {
    code: 'CANH_CHUA_CA_COM',
    name: 'Cơm và canh chua cá',
    mealSlot: 'LUNCH',
    kcal: 465,
    proteinG: 34,
    carbsG: 62,
    fatG: 9,
    tags: ['co:hai-san'],
    portionText:
      '1 phần (khoảng 500 g): 200 g cơm (1 chén) và 300 g canh chua gồm 120 g cá, cà chua, dọc mùng, giá.',
    description:
      'Canh chua nấu với cá, cà chua và rau thơm, ăn cùng một chén cơm. Một bữa trưa nhẹ nhàng.',
    imageKey: null,
  },
  {
    code: 'GOI_CUON_TOM_THIT',
    name: 'Gỏi cuốn tôm thịt',
    mealSlot: 'LUNCH',
    kcal: 425,
    proteinG: 24,
    carbsG: 55,
    fatG: 12,
    tags: [
      'ngoai-hang',
      'co:thit-do',
      'co:hai-san',
      'co:dau-phong',
      'co:dau-nanh',
    ],
    portionText:
      '1 phần (khoảng 300 g): 5 cuốn tôm, thịt heo luộc, bún và rau thơm (270 g), 30 g tương đậu phộng để chấm.',
    description:
      'Gỏi cuốn tươi với tôm, thịt heo luộc và rau sống, chấm tương đậu phộng.',
    imageKey: null,
  },
  {
    code: 'MI_XAO_RAU_CU_CHAY',
    name: 'Mì xào rau củ chay',
    mealSlot: 'LUNCH',
    kcal: 580,
    proteinG: 22,
    carbsG: 82,
    fatG: 18,
    tags: ['chay', 'khong-thit', 'co:gluten', 'co:dau-nanh'],
    portionText:
      '1 đĩa (khoảng 400 g): 200 g mì không trứng đã luộc, 80 g đậu hũ, 40 g nấm, 50 g cải xanh, 30 g cà rốt, xào với nước tương.',
    description:
      'Mì không trứng xào nhanh với đậu hũ, nấm và rau củ. Món không dùng thịt, cá hay trứng.',
    imageKey: null,
  },
  {
    code: 'BUN_BO_NAM_BO',
    name: 'Bún bò Nam Bộ',
    mealSlot: 'LUNCH',
    kcal: 715,
    proteinG: 38,
    carbsG: 82,
    fatG: 26,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san', 'co:dau-phong'],
    portionText:
      '1 tô (khoảng 450 g): 150 g bún, 100 g thịt bò xào sả, 100 g rau sống, 20 g đậu phộng rang, 80 ml nước mắm chua ngọt.',
    description:
      'Bún trộn với thịt bò xào sả, rau sống và đậu phộng rang, rưới nước mắm chua ngọt.',
    imageKey: null,
  },
  {
    code: 'COM_CHIEN_TRUNG_RAU',
    name: 'Cơm chiên trứng và rau',
    mealSlot: 'LUNCH',
    kcal: 630,
    proteinG: 20,
    carbsG: 84,
    fatG: 24,
    tags: ['khong-thit', 'co:trung', 'co:dau-nanh'],
    portionText:
      '1 đĩa (khoảng 450 g): 280 g cơm nguội (khoảng 1,5 chén), 2 quả trứng (100 g), 70 g hành lá, cà rốt và đậu hà lan.',
    description:
      'Cơm nguội chiên với trứng và rau củ cắt hạt lựu, nêm nước tương. Làm nhanh bằng một chiếc chảo.',
    imageKey: null,
  },
  {
    code: 'BANH_MI_GA_XE',
    name: 'Bánh mì gà xé',
    mealSlot: 'LUNCH',
    kcal: 420,
    proteinG: 28,
    carbsG: 48,
    fatG: 13,
    tags: ['ngoai-hang', 'co:gia-cam', 'co:gluten'],
    portionText:
      '1 ổ (khoảng 230 g): 1 ổ bánh mì 90 g, 70 g thịt gà xé, 50 g dưa leo và rau thơm, 20 g sốt cà chua.',
    description:
      'Ổ bánh mì với thịt gà xé, dưa leo, rau thơm và sốt cà chua. Một bữa trưa gọn, ăn được cả khi đang di chuyển.',
    imageKey: null,
  },
  {
    code: 'COM_GA_XOI_MO',
    name: 'Cơm gà xối mỡ',
    mealSlot: 'LUNCH',
    kcal: 990,
    proteinG: 60,
    carbsG: 98,
    fatG: 40,
    tags: ['ngoai-hang', 'co:gia-cam'],
    portionText:
      '1 đĩa lớn (khoảng 700 g): 330 g cơm, 250 g thịt gà chiên xối mỡ (1 đùi góc tư), 120 g dưa leo và cà chua.',
    description:
      'Cơm trắng với đùi gà chiên giòn da, ăn cùng dưa leo, cà chua và muối tiêu chanh. Phần ăn lớn.',
    imageKey: null,
  },
  {
    code: 'BUN_DAU_MAM_TOM',
    name: 'Bún đậu mắm tôm',
    mealSlot: 'LUNCH',
    kcal: 915,
    proteinG: 46,
    carbsG: 70,
    fatG: 50,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san', 'co:dau-nanh'],
    portionText:
      '1 mẹt (khoảng 650 g): 300 g bún lá, 150 g đậu hũ chiên, 100 g thịt heo luộc và chả, 30 g mắm tôm pha, 70 g rau sống.',
    description:
      'Bún lá, đậu hũ chiên, thịt heo luộc và chả, chấm mắm tôm pha chanh, ăn kèm rau sống. Phần ăn lớn.',
    imageKey: null,
  },

  // ------------------------------------------------------------------ DINNER
  {
    code: 'CA_AP_CHAO_COM_RAU',
    name: 'Cá áp chảo, cơm và rau',
    mealSlot: 'DINNER',
    kcal: 720,
    proteinG: 45,
    carbsG: 85,
    fatG: 20,
    tags: ['co:hai-san'],
    portionText:
      '1 phần (khoảng 540 g): 1 phi lê cá áp chảo (khoảng 170 g), 270 g cơm, 100 g rau xào hoặc luộc.',
    description:
      'Phi lê cá áp chảo vàng hai mặt, ăn với cơm và rau theo mùa.',
    imageKey: 'xZxDr',
  },
  {
    code: 'DAU_HU_SOT_CA_COM',
    name: 'Đậu hũ sốt cà chua và cơm',
    mealSlot: 'DINNER',
    kcal: 515,
    proteinG: 24,
    carbsG: 66,
    fatG: 17,
    tags: ['chay', 'khong-thit', 'co:dau-nanh'],
    portionText:
      '1 phần (khoảng 500 g): 200 g đậu hũ chiên sốt cà chua, 200 g cơm (1 chén), 100 g rau luộc.',
    description:
      'Đậu hũ chiên om trong sốt cà chua, ăn với cơm và đĩa rau luộc. Món không dùng thịt, cá hay trứng.',
    imageKey: null,
  },
  {
    code: 'GA_KHO_GUNG_COM_CANH',
    name: 'Gà kho gừng, cơm và canh rau',
    mealSlot: 'DINNER',
    kcal: 680,
    proteinG: 40,
    carbsG: 80,
    fatG: 22,
    tags: ['co:gia-cam', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 570 g): 250 g cơm (khoảng 1,25 chén), 120 g thịt gà kho gừng, 200 ml canh rau.',
    description:
      'Thịt gà kho với nước mắm và gừng cho đậm đà, ăn với cơm nóng và bát canh rau.',
    imageKey: null,
  },
  {
    code: 'THIT_LUOC_RAU_COM',
    name: 'Thịt heo luộc, rau và cơm',
    mealSlot: 'DINNER',
    kcal: 530,
    proteinG: 30,
    carbsG: 62,
    fatG: 18,
    tags: ['it-nau', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 400 g): 100 g thịt heo luộc thái mỏng, 100 g rau luộc, 200 g cơm (1 chén), chén nhỏ nước mắm gừng.',
    description:
      'Thịt heo luộc thái mỏng, rau luộc và cơm, chấm nước mắm gừng. Gần như không cần nấu nướng cầu kỳ.',
    imageKey: null,
  },
  {
    code: 'CA_KHO_TO_COM_CANH',
    name: 'Cá kho tộ, cơm và canh rau',
    mealSlot: 'DINNER',
    kcal: 545,
    proteinG: 32,
    carbsG: 66,
    fatG: 17,
    tags: ['co:hai-san'],
    portionText:
      '1 phần (khoảng 520 g): 120 g cá kho tộ, 200 g cơm (1 chén), 200 ml canh rau.',
    description:
      'Cá kho trong nồi đất với nước mắm, nước màu và tiêu, ăn với cơm và canh rau.',
    imageKey: null,
  },
  {
    code: 'TOM_RIM_CANH_RAU_COM',
    name: 'Tôm rim, canh rau và cơm',
    mealSlot: 'DINNER',
    kcal: 520,
    proteinG: 30,
    carbsG: 78,
    fatG: 10,
    tags: ['co:hai-san'],
    portionText:
      '1 phần (khoảng 550 g): 100 g tôm rim, 250 g cơm (khoảng 1,25 chén), 200 ml canh rau.',
    description: 'Tôm rim mặn ngọt, ăn với cơm và canh rau nấu thanh.',
    imageKey: null,
  },
  {
    code: 'BO_XAO_RAU_MUONG_COM',
    name: 'Bò xào rau muống và cơm',
    mealSlot: 'DINNER',
    kcal: 700,
    proteinG: 36,
    carbsG: 80,
    fatG: 26,
    tags: ['co:thit-do', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 500 g): 100 g thịt bò xào, 150 g rau muống xào tỏi, 250 g cơm (khoảng 1,25 chén).',
    description:
      'Thịt bò xào nhanh lửa lớn, nêm nước mắm, ăn cùng rau muống xào tỏi và cơm.',
    imageKey: null,
  },
  {
    code: 'CHA_TRUNG_HAP_COM_CANH',
    name: 'Chả trứng hấp, cơm và canh',
    mealSlot: 'DINNER',
    kcal: 540,
    proteinG: 28,
    carbsG: 62,
    fatG: 20,
    tags: ['co:trung', 'co:thit-do', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 500 g): 100 g chả trứng hấp (trứng và thịt heo băm), 200 g cơm (1 chén), 200 ml canh.',
    description:
      'Trứng đánh với thịt heo băm và mộc nhĩ, nêm nước mắm, hấp chín, ăn với cơm và bát canh.',
    imageKey: null,
  },
  {
    code: 'CHAO_CA_RAU',
    name: 'Cháo cá rau',
    mealSlot: 'DINNER',
    kcal: 370,
    proteinG: 26,
    carbsG: 48,
    fatG: 8,
    tags: ['co:hai-san'],
    portionText:
      '1 tô (khoảng 430 g): cháo nấu từ 60 g gạo (khoảng 300 g cháo), 80 g cá, 50 g rau cải, hành lá, gừng.',
    description:
      'Cháo gạo nấu nhừ với cá và rau cải, thêm gừng và hành lá. Một bữa tối nhẹ.',
    imageKey: null,
  },
  {
    code: 'KHO_QUA_NHOI_THIT_COM',
    name: 'Khổ qua nhồi thịt và cơm',
    mealSlot: 'DINNER',
    kcal: 495,
    proteinG: 28,
    carbsG: 64,
    fatG: 14,
    tags: ['co:thit-do', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 450 g): 2 khúc khổ qua nhồi (khoảng 250 g, trong đó 80 g thịt heo băm) trong nước dùng, 200 g cơm (1 chén).',
    description:
      'Khổ qua nhồi thịt heo băm, nêm nước mắm, nấu mềm trong nước dùng, ăn với cơm.',
    imageKey: null,
  },
  {
    code: 'DUI_GA_NUONG_KHOAI_LANG',
    name: 'Đùi gà nướng và khoai lang',
    mealSlot: 'DINNER',
    kcal: 730,
    proteinG: 50,
    carbsG: 70,
    fatG: 28,
    tags: ['it-nau', 'co:gia-cam'],
    portionText:
      '1 phần (khoảng 730 g): 1 đùi gà góc tư nướng (khoảng 280 g cả xương, 200 g thịt), 300 g khoai lang, 150 g rau luộc.',
    description:
      'Đùi gà ướp muối tiêu nướng trong lò, ăn với khoai lang nướng và rau luộc.',
    imageKey: null,
  },
  {
    code: 'CANH_NAM_DAU_HU_COM',
    name: 'Canh nấm đậu hũ và cơm',
    mealSlot: 'DINNER',
    kcal: 410,
    proteinG: 18,
    carbsG: 62,
    fatG: 10,
    tags: ['chay', 'khong-thit', 'co:dau-nanh'],
    portionText:
      '1 phần (khoảng 650 g): 350 ml canh gồm 100 g đậu hũ và 80 g nấm, 200 g cơm (1 chén), 100 g rau xào.',
    description:
      'Canh nấm nấu với đậu hũ và rau, ăn cùng cơm và đĩa rau xào nhỏ. Món không dùng thịt, cá hay trứng.',
    imageKey: null,
  },
  {
    code: 'BO_KHO_BANH_MI',
    name: 'Bò kho bánh mì',
    mealSlot: 'DINNER',
    kcal: 745,
    proteinG: 40,
    carbsG: 72,
    fatG: 33,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san', 'co:gluten'],
    portionText:
      '1 tô (khoảng 520 g): 150 g thịt bò kho, 100 g cà rốt và khoai tây, 150 ml nước sốt, 1 ổ bánh mì (khoảng 120 g).',
    description:
      'Thịt bò hầm mềm với cà rốt, sả, nêm nước mắm, chấm cùng ổ bánh mì nóng.',
    imageKey: null,
  },
  {
    code: 'MIEN_XAO_NAM_CHAY',
    name: 'Miến xào nấm chay',
    mealSlot: 'DINNER',
    kcal: 445,
    proteinG: 14,
    carbsG: 70,
    fatG: 12,
    tags: ['chay', 'khong-thit', 'co:dau-nanh'],
    portionText:
      '1 đĩa (khoảng 350 g): 200 g miến đã ngâm (từ 80 g miến khô), 60 g nấm, 50 g đậu hũ, 40 g cà rốt và cải, xào với nước tương.',
    description:
      'Miến dong xào với nấm, đậu hũ và rau củ. Món không dùng thịt, cá hay trứng.',
    imageKey: null,
  },
  {
    code: 'BO_BIT_TET_KHOAI_TAY',
    name: 'Bò bít tết, khoai tây và bánh mì',
    mealSlot: 'DINNER',
    kcal: 880,
    proteinG: 55,
    carbsG: 75,
    fatG: 40,
    tags: ['ngoai-hang', 'co:thit-do', 'co:gluten'],
    portionText:
      '1 phần (khoảng 480 g): 180 g bò bít tết, 150 g khoai tây chiên, 1 ổ bánh mì nhỏ (50 g), 100 g xà lách và cà chua.',
    description:
      'Bò bít tết áp chảo với khoai tây chiên, bánh mì và rau trộn, rưới sốt tiêu. Phần ăn lớn.',
    imageKey: null,
  },
  {
    code: 'MI_Y_SOT_BO_BAM',
    name: 'Mì Ý sốt bò bằm',
    mealSlot: 'DINNER',
    kcal: 735,
    proteinG: 36,
    carbsG: 98,
    fatG: 22,
    tags: ['ngoai-hang', 'co:thit-do', 'co:gluten'],
    portionText:
      '1 đĩa (khoảng 490 g): 280 g mì Ý đã luộc (từ 120 g mì khô), 110 g thịt bò bằm, 100 g sốt cà chua.',
    description:
      'Mì Ý trộn với sốt cà chua nấu cùng thịt bò bằm, làm xong trong một nồi sốt.',
    imageKey: null,
  },
  {
    code: 'GA_RO_TI_COM',
    name: 'Gà rô ti và cơm',
    mealSlot: 'DINNER',
    kcal: 895,
    proteinG: 52,
    carbsG: 95,
    fatG: 34,
    tags: ['co:gia-cam', 'co:hai-san'],
    portionText:
      '1 phần (khoảng 650 g): 320 g cơm, 200 g thịt gà rô ti (1 đùi góc tư), 80 g dưa leo và rau, 50 ml nước sốt.',
    description:
      'Thịt gà chiên rồi rim với nước mắm và đường cho thấm, ăn với cơm và rau. Phần ăn lớn.',
    imageKey: null,
  },

  // ------------------------------------------------------------------- SNACK
  {
    code: 'CHUOI_CHIN',
    name: 'Chuối chín',
    mealSlot: 'SNACK',
    kcal: 100,
    proteinG: 1.5,
    carbsG: 23,
    fatG: 0.5,
    tags: ['chay', 'khong-thit', 'it-nau', 'ngoai-hang'],
    portionText: '1 quả chuối vừa (khoảng 100 g không vỏ).',
    description: 'Một quả chuối chín, bóc vỏ là ăn được, dễ mang theo.',
    imageKey: null,
  },
  {
    code: 'SUA_DAU_NANH',
    name: 'Sữa đậu nành',
    mealSlot: 'SNACK',
    kcal: 135,
    proteinG: 8,
    carbsG: 14,
    fatG: 5,
    tags: ['chay', 'khong-thit', 'it-nau', 'ngoai-hang', 'co:dau-nanh'],
    portionText: '1 ly (250 ml), ít đường.',
    description: 'Sữa đậu nành nguyên chất pha ít đường, uống lạnh hoặc ấm.',
    imageKey: null,
  },
  {
    code: 'NGO_LUOC',
    name: 'Bắp luộc',
    mealSlot: 'SNACK',
    kcal: 150,
    proteinG: 5,
    carbsG: 28,
    fatG: 2,
    tags: ['chay', 'khong-thit', 'ngoai-hang'],
    portionText: '1 bắp vừa (khoảng 200 g, tính cả lõi).',
    description:
      'Bắp luộc chín, ăn nóng. Món vặt quen thuộc ở vỉa hè và chợ.',
    imageKey: null,
  },
  {
    code: 'TRUNG_LUOC_CA_CHUA_BI',
    name: 'Trứng luộc và cà chua bi',
    mealSlot: 'SNACK',
    kcal: 160,
    proteinG: 13,
    carbsG: 4,
    fatG: 10,
    tags: ['khong-thit', 'it-nau', 'co:trung'],
    portionText:
      '1 phần (khoảng 150 g): 2 quả trứng gà luộc (khoảng 100 g), 5 quả cà chua bi (khoảng 50 g).',
    description:
      'Trứng luộc chín bóc vỏ, ăn kèm vài quả cà chua bi và chút muối tiêu.',
    imageKey: null,
  },
  {
    code: 'DAU_PHONG_LUOC',
    name: 'Đậu phộng luộc',
    mealSlot: 'SNACK',
    kcal: 165,
    proteinG: 7,
    carbsG: 10,
    fatG: 11,
    tags: ['chay', 'khong-thit', 'co:dau-phong'],
    portionText: '1 nắm (khoảng 50 g hạt đã bóc vỏ), luộc muối.',
    description:
      'Đậu phộng luộc với chút muối, bùi và mềm. Dễ mang theo trong hộp nhỏ.',
    imageKey: null,
  },
  {
    code: 'KHOAI_LANG_LUOC',
    name: 'Khoai lang luộc',
    mealSlot: 'SNACK',
    kcal: 175,
    proteinG: 3,
    carbsG: 40,
    fatG: 0.5,
    tags: ['chay', 'khong-thit', 'it-nau', 'ngoai-hang'],
    portionText: '1 củ vừa (khoảng 200 g).',
    description:
      'Khoai lang luộc hoặc hấp chín mềm, ăn nóng hay để nguội đều được.',
    imageKey: null,
  },
  {
    code: 'SUA_CHUA_TRAI_CAY',
    name: 'Sữa chua và trái cây',
    mealSlot: 'SNACK',
    kcal: 200,
    proteinG: 5,
    carbsG: 38,
    fatG: 3,
    tags: ['khong-thit', 'it-nau', 'co:sua'],
    portionText:
      '1 phần (khoảng 300 g): 150 g sữa chua, 150 g xoài hoặc thanh long cắt miếng.',
    description: 'Sữa chua ít đường trộn với trái cây cắt miếng theo mùa.',
    imageKey: null,
  },
  {
    code: 'CHE_DAU_XANH',
    name: 'Chè đậu xanh',
    mealSlot: 'SNACK',
    kcal: 220,
    proteinG: 6,
    carbsG: 40,
    fatG: 4,
    tags: ['chay', 'khong-thit', 'ngoai-hang'],
    portionText: '1 bát nhỏ (khoảng 200 ml).',
    description: 'Đậu xanh nấu nhừ với đường và nước cốt dừa, ăn ấm hoặc lạnh.',
    imageKey: null,
  },
  {
    code: 'BANH_GIO',
    name: 'Bánh giò',
    mealSlot: 'SNACK',
    kcal: 260,
    proteinG: 9,
    carbsG: 33,
    fatG: 10,
    tags: ['ngoai-hang', 'co:thit-do', 'co:hai-san'],
    portionText: '1 cái (khoảng 150 g), nhân thịt heo băm và mộc nhĩ.',
    description:
      'Bánh bột gạo gói lá chuối, nhân thịt heo băm và mộc nhĩ nêm nước mắm, ăn nóng.',
    imageKey: null,
  },
  {
    code: 'XOI_DAU_XANH',
    name: 'Xôi đậu xanh',
    mealSlot: 'SNACK',
    kcal: 280,
    proteinG: 7,
    carbsG: 52,
    fatG: 5,
    tags: ['chay', 'khong-thit', 'ngoai-hang'],
    portionText: '1 gói nhỏ (khoảng 150 g), có hành phi.',
    description:
      'Xôi nếp với đậu xanh nghiền và hành phi. Đủ no để đợi đến bữa kế tiếp.',
    imageKey: null,
  },
  {
    code: 'SUA_CHUA_VA_HAT',
    name: 'Sữa chua và hạt',
    mealSlot: 'SNACK',
    kcal: 290,
    proteinG: 12,
    carbsG: 22,
    fatG: 17,
    tags: ['khong-thit', 'it-nau', 'co:sua'],
    portionText:
      '1 phần (khoảng 175 g): 150 g sữa chua không đường, 25 g hạt điều, hạnh nhân hoặc óc chó.',
    description:
      'Sữa chua không đường rắc hạt. Không cần nấu nướng, ăn ở đâu cũng tiện.',
    imageKey: null,
  },
  {
    code: 'BANH_BAO_NHAN_THIT',
    name: 'Bánh bao nhân thịt',
    mealSlot: 'SNACK',
    kcal: 295,
    proteinG: 11,
    carbsG: 42,
    fatG: 9,
    tags: ['ngoai-hang', 'co:thit-do', 'co:trung', 'co:gluten'],
    portionText: '1 cái vừa (khoảng 130 g), vỏ bột mì, nhân thịt heo và trứng cút.',
    description: 'Bánh bao hấp nóng, vỏ bột mì, nhân thịt heo băm và trứng cút.',
    imageKey: null,
  },
];
