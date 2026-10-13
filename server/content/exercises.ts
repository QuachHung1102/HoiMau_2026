import type { Archetype, Modality, SpaceRequirement } from '../../domain/types.ts';
import type {
  Equipment,
  MoveSeed,
  WorkoutSeed,
  WorkoutStepSeed,
} from './types.ts';

// Exercise library: moves and workouts (spec F-05, PLAN P1.4 `exercise_*`). Vietnamese, self-authored.
// NOT reviewed by a fitness or medical professional (R-D10): the content is general guidance for
// beginners, makes no promise of results and no medical claim, and must stay worded as such.
// Every move has exactly 3 short instruction steps and one caution line that says when to stop or
// ease off. Only the seven rigged moves (the starter set of PLAN Task 21) carry a `demoCode`.
// Timing rule for every workout: sum WARMUP + `sets` x sum MAIN + sum COOLDOWN seconds = `durationSec`,
// each step at least 20 s. A step's text is honest for its seconds: a hold or a count that is shorter
// than the step says what fills the rest ("lặp lại đến hết giờ", "nghỉ ..."), and a count of breaths
// fits the seconds of the step.
// `archetypes` is the archetype the workout is preferred for: TANKER = RESISTANCE,
// ASSASSIN = CARDIO / HIIT, SUPPORTER = MOBILITY / BREATHING.
// `equipment` is empty for "Không cần". It lists an item only when a move REQUIRES it (dumbbells
// `ta-tay`, a band `day-khang-luc`); a mat is optional, so floor moves offer "thảm hoặc khăn gấp" and
// no workout declares `tham`.
// `metValue` is a general estimate inside the range of its modality, not a measurement; where less
// than half of a workout's time is at the working intensity of its modality it is the minimum of
// that range, so that the kcal estimate does not flatter.

export const MOVES: MoveSeed[] = [
  // ------------------------------------------------ the starter set (rigged demos)
  {
    code: 'XOAY_VAI',
    name: 'Xoay vai',
    demoCode: 'exercise-xoay-vai',
    steps: [
      'Đứng thẳng, hai chân rộng bằng vai, hai tay thả lỏng.',
      'Nhấc vai lên gần tai, rồi đưa ra sau theo vòng tròn chậm.',
      'Sau vài vòng, đổi chiều xoay và giữ nhịp thở đều.',
    ],
    caution:
      'Dừng nếu vai đau, tê, khó chịu hoặc thấy chóng mặt; có thể xoay vòng nhỏ hơn.',
  },
  {
    code: 'SQUAT_TAY_TRUOC_NGUC',
    name: 'Squat tay trước ngực',
    demoCode: 'exercise-squat',
    steps: [
      'Đứng hai chân rộng bằng vai, hai tay chắp trước ngực.',
      'Đẩy hông ra sau, hạ người như ngồi xuống ghế, lưng thẳng, đầu gối hướng theo mũi chân.',
      'Đẩy gót chân xuống sàn để đứng lên, thở ra khi đứng.',
    ],
    caution:
      'Dừng nếu đầu gối hoặc lưng đau; hạ người nông hơn, hoặc nghỉ nếu thấy chóng mặt.',
  },
  {
    code: 'CHONG_DAY_TUA_BAN',
    name: 'Chống đẩy tựa bàn',
    demoCode: 'exercise-chong-day-tua-ban',
    steps: [
      'Đặt hai tay lên mép bàn vững, rộng hơn vai một chút, người thẳng từ đầu đến gót.',
      'Gập khuỷu tay, hạ ngực về phía mép bàn, bụng siết nhẹ.',
      'Đẩy tay để trở về, thở ra khi đẩy lên.',
    ],
    caution:
      'Chọn bàn thật vững, không trượt. Dừng nếu cổ tay hoặc vai đau; đứng gần bàn hơn cho nhẹ sức, hoặc nghỉ.',
  },
  {
    code: 'CHUNG_CHAN_LUI',
    name: 'Chùng chân lùi',
    demoCode: 'exercise-chung-chan-lui',
    steps: [
      'Đứng thẳng, vịn vào thành ghế hoặc tường nếu cần giữ thăng bằng.',
      'Bước một chân ra sau, hạ người thẳng xuống; đầu gối trước trên mắt cá, đầu gối sau không chạm sàn.',
      'Đẩy chân trước để đứng lên; làm đủ số lần một bên rồi đổi bên.',
    ],
    caution:
      'Dừng nếu đầu gối đau hoặc mất thăng bằng; bước ngắn hơn và hạ người nông hơn.',
  },
  {
    code: 'PLANK_TUA_GOI',
    name: 'Plank tựa gối',
    demoCode: 'exercise-plank-tua-goi',
    steps: [
      'Quỳ trên thảm hoặc khăn gấp, chống hai khuỷu tay ngay dưới vai.',
      'Nhấc người sao cho thẳng từ đầu đến đầu gối, siết bụng nhẹ.',
      'Giữ yên và thở đều, rồi hạ người xuống nghỉ.',
    ],
    caution:
      'Dừng nếu lưng dưới, vai hoặc khuỷu tay đau; hạ người xuống nghỉ bất cứ lúc nào.',
  },
  {
    code: 'THA_LONG_VAI',
    name: 'Thả lỏng vai',
    demoCode: 'exercise-tha-long-vai',
    steps: [
      'Đứng hoặc ngồi thoải mái, hai tay buông dọc người.',
      'Hít vào và nhấc hai vai lên nhẹ.',
      'Thở ra thật chậm, thả vai xuống, lặp lại vài nhịp.',
    ],
    caution:
      'Nhấc vai vừa phải; dừng nếu cổ hoặc vai khó chịu, hoặc thấy chóng mặt.',
  },
  {
    code: 'THO_4_4',
    name: 'Thở 4-4',
    demoCode: 'focus-breathe',
    steps: [
      'Ngồi hoặc đứng thoải mái, một tay đặt lên bụng.',
      'Hít vào bằng mũi trong 4 giây.',
      'Thở ra từ từ trong 4 giây, rồi lặp lại theo nhịp.',
    ],
    caution:
      'Thở nhẹ, không gắng sức. Nếu thấy chóng mặt, dừng lại và thở tự nhiên.',
  },
  // ------------------------------------------------ mobility and stretching
  {
    code: 'NGHIENG_CO',
    name: 'Nghiêng cổ nhẹ',
    demoCode: null,
    steps: [
      'Ngồi hoặc đứng thẳng, vai thả lỏng.',
      'Nghiêng tai về phía vai phải đến khi thấy giãn nhẹ, rồi trở về giữa.',
      'Làm tương tự sang bên trái, thật chậm rãi.',
    ],
    caution:
      'Không xoay tròn cổ hay vặn mạnh. Dừng nếu cổ đau, tê tay hoặc chóng mặt.',
  },
  {
    code: 'MO_NGUC',
    name: 'Mở ngực',
    demoCode: null,
    steps: [
      'Ngồi hoặc đứng thẳng, đan tay sau lưng, hoặc nắm hai bên ghế nếu không với tới.',
      'Nâng ngực lên, kéo nhẹ hai vai ra sau, không ưỡn lưng dưới.',
      'Giữ vài nhịp thở rồi thả tay.',
    ],
    caution:
      'Nếu ngồi, chọn ghế không lăn hoặc tựa lưng ghế vào tường. Chỉ mở ngực đến mức thoải mái. Dừng nếu vai hoặc lưng đau.',
  },
  {
    code: 'GIAN_CO_TAY',
    name: 'Giãn cổ tay',
    demoCode: null,
    steps: [
      'Duỗi một tay ra trước, lòng bàn tay hướng lên.',
      'Dùng tay kia kéo nhẹ các ngón tay xuống phía sàn, khuỷu tay thẳng nhưng không khóa cứng.',
      'Giữ vài nhịp thở rồi đổi tay.',
    ],
    caution: 'Kéo thật nhẹ. Dừng nếu cổ tay đau hoặc ngón tay bị tê.',
  },
  {
    code: 'XOAY_THAN_NGOI',
    name: 'Xoay thân khi ngồi',
    demoCode: null,
    steps: [
      'Ngồi thẳng trên ghế, hai bàn chân đặt vững trên sàn.',
      'Đặt tay lên vai hoặc đùi, xoay thân từ từ sang một bên.',
      'Trở về giữa rồi xoay sang bên còn lại.',
    ],
    caution:
      'Chọn ghế không lăn, hoặc tựa lưng ghế vào tường. Xoay vừa phải, hông giữ yên. Dừng nếu lưng đau.',
  },
  {
    code: 'GIAN_LUNG_NGOI',
    name: 'Cúi người giãn lưng',
    demoCode: null,
    steps: [
      'Ngồi trên ghế, hai chân đặt vững trên sàn, rộng bằng hông.',
      'Thở ra và cúi người từ từ, để hai tay thả xuống phía đùi hoặc sàn.',
      'Giữ vài nhịp thở rồi ngồi thẳng dậy thật chậm.',
    ],
    caution:
      'Chọn ghế không lăn, hoặc tựa lưng ghế vào tường. Cúi đến mức thoải mái, ngồi dậy chậm. Dừng nếu lưng đau hoặc chóng mặt.',
  },
  {
    code: 'MEO_BO',
    name: 'Cong và võng lưng',
    demoCode: null,
    steps: [
      'Chống hai tay và hai đầu gối trên sàn, trải thảm hoặc khăn gấp bên dưới.',
      'Thở ra, cong nhẹ lưng lên và cúi đầu.',
      'Hít vào, võng nhẹ lưng xuống và nhìn ra trước.',
    ],
    caution:
      'Chuyển động nhỏ và chậm. Dừng nếu cổ tay, đầu gối hoặc lưng đau.',
  },
  {
    code: 'GIAN_DUI_TRUOC',
    name: 'Giãn đùi trước',
    demoCode: null,
    steps: [
      'Đứng thẳng, một tay vịn vào tường, cây, hàng rào hoặc ghế.',
      'Gập một đầu gối, nắm nhẹ cổ chân và đưa gót về phía mông.',
      'Giữ vài nhịp thở rồi đổi chân.',
    ],
    caution:
      'Chọn chỗ vịn vững. Dừng nếu đầu gối đau, chóng mặt hoặc khó giữ thăng bằng; chỉ kéo đến mức thoải mái.',
  },
  {
    code: 'GIAN_BAP_CHAN',
    name: 'Giãn bắp chân',
    demoCode: null,
    steps: [
      'Đứng đối diện tường, cây hoặc hàng rào, hai tay chạm lên đó ngang vai.',
      'Bước một chân ra sau, giữ gót chân sau chạm sàn.',
      'Nghiêng người nhẹ về phía trước, giữ vài nhịp thở rồi đổi chân.',
    ],
    caution:
      'Chọn chỗ vững. Chỉ nghiêng đến khi thấy giãn nhẹ. Dừng nếu bắp chân hoặc gót chân đau, hoặc chóng mặt.',
  },
  {
    code: 'XOAY_HONG',
    name: 'Xoay hông',
    demoCode: null,
    steps: [
      'Đứng hai chân rộng hơn vai một chút, hai tay chống hông.',
      'Xoay hông thành vòng tròn vừa, chậm rãi.',
      'Sau vài vòng, đổi chiều xoay.',
    ],
    caution:
      'Xoay trong tầm thoải mái. Dừng nếu hông hoặc lưng dưới đau, hoặc thấy chóng mặt.',
  },
  // ------------------------------------------------ strength, own body weight
  {
    code: 'DUNG_LEN_NGOI_XUONG',
    name: 'Đứng lên ngồi xuống ghế',
    demoCode: null,
    steps: [
      'Ngồi ở mép một chiếc ghế vững, hai chân rộng bằng hông, hai tay khoanh trước ngực.',
      'Nghiêng người ra trước và đứng lên bằng sức hai chân.',
      'Đẩy hông ra sau, ngồi xuống chậm rãi.',
    ],
    caution:
      'Chọn ghế không trượt, tựa lưng ghế vào tường nếu cần. Dừng nếu đầu gối đau hoặc thấy chóng mặt.',
  },
  {
    code: 'CHONG_DAY_TUONG',
    name: 'Chống đẩy tựa tường',
    demoCode: null,
    steps: [
      'Đứng cách tường một bước chân, đặt hai tay lên tường ngang vai.',
      'Gập khuỷu tay, đưa ngực lại gần tường, người giữ thẳng.',
      'Đẩy tay để trở về, thở ra khi đẩy.',
    ],
    caution:
      'Dừng nếu vai hoặc cổ tay đau; đứng gần tường hơn cho nhẹ sức.',
  },
  {
    code: 'NHON_GOT',
    name: 'Nhón gót',
    demoCode: null,
    steps: [
      'Đứng thẳng, vịn nhẹ vào ghế hoặc tường.',
      'Nhón hai gót lên từ từ, thở ra.',
      'Hạ gót xuống chậm rãi.',
    ],
    caution:
      'Dừng nếu bắp chân đau hoặc mất thăng bằng; luôn giữ một tay vịn.',
  },
  {
    code: 'CAU_MONG',
    name: 'Cầu mông',
    demoCode: null,
    steps: [
      'Nằm ngửa trên thảm hoặc khăn gấp, gập hai đầu gối, hai bàn chân đặt trên sàn.',
      'Thở ra và nhấc hông lên đến khi người gần thẳng từ vai đến đầu gối.',
      'Hạ hông xuống chậm rãi.',
    ],
    caution:
      'Không ưỡn lưng quá mức. Dừng nếu lưng dưới đau hoặc đùi bị chuột rút.',
  },
  {
    code: 'TAY_CHAN_DOI_DIEN',
    name: 'Tay chân đối diện',
    demoCode: null,
    steps: [
      'Chống hai tay và hai đầu gối trên thảm hoặc khăn gấp, lưng thẳng.',
      'Duỗi tay phải ra trước và chân trái ra sau, giữ hông cân bằng.',
      'Trở về vị trí đầu rồi đổi bên.',
    ],
    caution:
      'Chỉ duỗi đến mức giữ được lưng thẳng. Dừng nếu cổ tay, đầu gối hoặc lưng đau.',
  },
  // ------------------------------------------------ strength, dumbbells and band
  {
    code: 'SQUAT_TA_TAY',
    name: 'Squat cầm tạ tay',
    demoCode: null,
    steps: [
      'Đứng hai chân rộng bằng vai, hai tay ôm một quả tạ trước ngực.',
      'Đẩy hông ra sau và hạ người xuống, lưng thẳng, đầu gối hướng theo mũi chân.',
      'Đẩy gót xuống sàn để đứng lên.',
    ],
    caution:
      'Chọn tạ nhẹ để giữ được tư thế đúng. Dừng nếu đầu gối hoặc lưng đau; đặt tạ xuống và nghỉ.',
  },
  {
    code: 'DAY_VAI_TA_TAY',
    name: 'Đẩy vai với tạ tay',
    demoCode: null,
    steps: [
      'Đứng hoặc ngồi thẳng, hai tay cầm tạ ngang vai.',
      'Thở ra, đẩy tạ lên phía trên đầu đến khi tay gần thẳng.',
      'Hạ tạ về ngang vai chậm rãi.',
    ],
    caution:
      'Chọn tạ nhẹ, siết bụng nhẹ, không ưỡn lưng. Dừng nếu vai hoặc cổ đau; đặt tạ xuống nghỉ.',
  },
  {
    code: 'CHEO_TA_TAY',
    name: 'Chèo tạ tay',
    demoCode: null,
    steps: [
      'Một tay và một đầu gối chống lên ghế hoặc mép sofa thật vững, lưng thẳng; tay kia cầm tạ.',
      'Kéo khuỷu tay lên sát sườn, khép nhẹ bả vai.',
      'Hạ tạ chậm rãi, làm hết lượt rồi đổi bên.',
    ],
    caution:
      'Chọn chỗ chống thật vững, không trượt. Giữ lưng thẳng và chọn tạ nhẹ. Dừng nếu lưng hoặc vai đau.',
  },
  {
    code: 'GAP_HONG_TA_TAY',
    name: 'Gập hông với tạ tay',
    demoCode: null,
    steps: [
      'Đứng hai chân rộng bằng hông, hai tay cầm tạ trước đùi, đầu gối chùng nhẹ.',
      'Đẩy hông ra sau, gập từ hông chứ không cúi lưng; hạ tạ tối đa đến ngang đầu gối.',
      'Dừng hạ sớm hơn khi thấy căng mặt sau đùi, rồi siết mông để đứng thẳng.',
    ],
    caution:
      'Giữ lưng thẳng, chọn tạ nhẹ. Dừng nếu lưng dưới hoặc mặt sau đùi đau.',
  },
  {
    code: 'CUON_TAY_TA',
    name: 'Cuộn tạ tay trước',
    demoCode: null,
    steps: [
      'Đứng thẳng, hai tay cầm tạ buông dọc người, lòng bàn tay hướng ra trước.',
      'Gập khuỷu tay, đưa tạ lên gần vai, khuỷu tay giữ sát sườn.',
      'Hạ tạ xuống chậm rãi.',
    ],
    caution:
      'Không vung người lấy đà. Dừng nếu khuỷu tay hoặc cổ tay đau; đặt tạ xuống nghỉ.',
  },
  {
    code: 'KEO_DAY_NGANG',
    name: 'Kéo dây kháng lực',
    demoCode: null,
    steps: [
      'Ngồi hoặc đứng, móc dây quanh chân ghế nặng hoặc điểm móc chắc phía trước, hai tay nắm dây.',
      'Kéo hai tay về phía thân, khuỷu tay sát sườn, khép nhẹ bả vai.',
      'Thả dây về chậm rãi, giữ dây luôn hơi căng.',
    ],
    caution:
      'Kiểm tra dây không rách và điểm móc vững. Dừng nếu vai hoặc lưng đau, hoặc dây bị trượt.',
  },
  {
    code: 'BUOC_NGANG_DAY',
    name: 'Bước ngang với dây kháng lực',
    demoCode: null,
    steps: [
      'Đặt vòng dây quanh hai đùi, phía trên đầu gối; đứng hai chân rộng bằng hông.',
      'Bước một chân sang ngang, giữ dây căng vừa phải.',
      'Đưa chân kia lại gần, lặp lại và đổi hướng sau mỗi lượt.',
    ],
    caution:
      'Chọn dây nhẹ, vịn tường nếu cần. Dừng nếu đầu gối hoặc hông đau.',
  },
  // ------------------------------------------------ cardio and intervals
  {
    code: 'DI_TAI_CHO',
    name: 'Đi bộ tại chỗ',
    demoCode: null,
    steps: [
      'Đứng thẳng, hai tay thả lỏng hai bên.',
      'Nhấc từng chân lên nhẹ nhàng như đang đi, hai tay vung nhịp nhàng.',
      'Giữ hơi thở đều, tốc độ vừa phải.',
    ],
    caution:
      'Giữ tốc độ mà bạn vẫn nói chuyện được. Giảm nhịp hoặc dừng nếu khó thở, chóng mặt hoặc tức ngực.',
  },
  {
    code: 'NANG_GOI',
    name: 'Nâng đầu gối',
    demoCode: null,
    steps: [
      'Đứng thẳng, hai tay co ở ngang hông.',
      'Nâng một đầu gối lên ngang hông, tay đối diện vung nhẹ lên.',
      'Đổi chân đều nhịp, đặt bàn chân xuống nhẹ.',
    ],
    caution:
      'Nâng thấp hơn nếu cần. Giảm nhịp hoặc dừng nếu khó thở, chóng mặt, tức ngực, đầu gối đau hoặc mất thăng bằng.',
  },
  {
    code: 'GOT_CHAM_MONG',
    name: 'Gót chạm mông',
    demoCode: null,
    steps: [
      'Đứng thẳng, hai tay thả lỏng.',
      'Gập một đầu gối, đưa gót chân lên phía sau.',
      'Đổi chân đều nhịp, đặt chân xuống nhẹ.',
    ],
    caution:
      'Đưa gót lên vừa tầm. Giảm nhịp hoặc dừng nếu đầu gối đau, khó thở, chóng mặt hoặc tức ngực.',
  },
  {
    code: 'DANG_TAY_BUOC_NGANG',
    name: 'Dang tay bước ngang',
    demoCode: null,
    steps: [
      'Đứng hai chân khép, hai tay buông dọc người.',
      'Bước một chân sang ngang, đồng thời đưa hai tay lên cao.',
      'Đưa chân về, hạ tay xuống rồi đổi bên.',
    ],
    caution:
      'Bước nhẹ, không nhảy. Giảm nhịp hoặc dừng nếu khó thở, chóng mặt, tức ngực, vai hoặc đầu gối đau.',
  },
  {
    code: 'DI_BO_NHANH',
    name: 'Đi bộ nhanh',
    demoCode: null,
    steps: [
      'Chọn đoạn đường phẳng, an toàn; ngực mở, mắt nhìn phía trước.',
      'Đi nhanh hơn bình thường, hai tay vung nhịp nhàng.',
      'Giữ nhịp thở đều, tốc độ mà bạn vẫn nói chuyện được.',
    ],
    caution:
      'Mang giày êm và để ý xe cộ. Chậm lại hoặc dừng nếu khó thở, chóng mặt, tức ngực hoặc thấy đau.',
  },
  {
    code: 'CHAY_BO_NHE',
    name: 'Chạy bộ nhẹ',
    demoCode: null,
    steps: [
      'Chọn đoạn đường phẳng, an toàn và mang giày êm.',
      'Chạy chậm, bước ngắn, thân hơi nghiêng ra trước.',
      'Thở đều, giữ tốc độ mà bạn vẫn nói được từng câu ngắn.',
    ],
    caution:
      'Chuyển sang đi bộ ngay nếu khó thở, chóng mặt, tức ngực hoặc đau chân. Không cần ép tốc độ.',
  },
  {
    code: 'NHUN_NHE',
    name: 'Nhún nhẹ tại chỗ',
    demoCode: null,
    steps: [
      'Đứng hai chân rộng bằng vai, đầu gối chùng nhẹ.',
      'Nhún nhẹ trên nửa bàn chân, gót chỉ rời sàn một chút.',
      'Tay thả lỏng, thở đều, tiếp đất thật êm.',
    ],
    caution:
      'Giữ bước nhún thấp và êm. Giảm nhịp hoặc dừng nếu đầu gối, mắt cá hoặc lưng đau, hoặc nếu khó thở, chóng mặt, tức ngực.',
  },
  {
    code: 'LEO_NUI_TUA_BAN',
    name: 'Leo núi tựa bàn',
    demoCode: null,
    steps: [
      'Đặt hai tay lên mép bàn vững, người thẳng từ đầu đến gót.',
      'Kéo một đầu gối về phía ngực, siết bụng nhẹ.',
      'Đưa chân về và đổi chân, nhịp chậm và đều.',
    ],
    caution:
      'Chọn bàn thật vững, giữ nhịp chậm. Dừng nếu cổ tay, vai hoặc lưng đau, hoặc nếu khó thở, chóng mặt, tức ngực.',
  },
  {
    code: 'DI_BO_CHAM',
    name: 'Đi bộ chậm',
    demoCode: null,
    steps: [
      'Chọn chỗ đi bằng phẳng, an toàn; thả lỏng hai tay.',
      'Đi với tốc độ chậm, bước đều, hít vào bằng mũi và thở ra từ từ.',
      'Giữ nhịp bước và nhịp thở đều, nhẹ nhàng.',
    ],
    caution:
      'Đi chậm vừa sức, không cần nhanh. Nếu thấy chóng mặt, tức ngực hoặc khó thở, dừng lại và ngồi nghỉ.',
  },
  // ------------------------------------------------ breathing and relaxing
  {
    code: 'THO_BUNG',
    name: 'Thở bụng',
    demoCode: null,
    steps: [
      'Ngồi hoặc nằm thoải mái, một tay đặt lên bụng.',
      'Hít vào bằng mũi, để bụng phồng nhẹ dưới tay.',
      'Thở ra từ từ, để bụng xẹp xuống.',
    ],
    caution:
      'Thở nhẹ, không gắng sức. Nếu thấy chóng mặt, thở lại bình thường và nghỉ.',
  },
  {
    code: 'THO_RA_DAI',
    name: 'Thở ra dài',
    demoCode: null,
    steps: [
      'Ngồi thoải mái, vai thả lỏng.',
      'Hít vào bằng mũi trong 4 giây.',
      'Thở ra chậm trong 6 giây, như thổi nhẹ một ngọn nến.',
    ],
    caution:
      'Thở ra nhẹ, không ép hơi. Nếu thấy chóng mặt, quay về thở bình thường.',
  },
  {
    code: 'THO_VUONG',
    name: 'Thở vuông',
    demoCode: null,
    steps: [
      'Ngồi thoải mái, lưng thẳng.',
      'Hít vào 4 giây, giữ hơi nhẹ 4 giây, thở ra 4 giây, nghỉ nhẹ 4 giây.',
      'Lặp lại theo nhịp, giữ mặt và vai thả lỏng.',
    ],
    caution:
      'Rút ngắn quãng giữ hơi nếu thấy tức ngực hay hồi hộp. Nếu thấy chóng mặt, quay về thở bình thường.',
  },
  {
    code: 'QUET_CO_THE',
    name: 'Thả lỏng từng vùng',
    demoCode: null,
    steps: [
      'Ngồi hoặc nằm thoải mái ở nơi an toàn.',
      'Chú ý lần lượt từ trán, vai, tay, bụng đến chân.',
      'Ở mỗi vùng, thở ra và thả lỏng cơ.',
    ],
    caution:
      'Không làm khi đang lái xe. Dừng và thở bình thường nếu thấy chóng mặt hoặc không thoải mái.',
  },
];

type Row = [moveCode: string, seconds: number, repsText: string];

const PREFERRED: Record<Modality, Archetype> = {
  RESISTANCE: 'TANKER',
  CARDIO: 'ASSASSIN',
  HIIT: 'ASSASSIN',
  MOBILITY: 'SUPPORTER',
  BREATHING: 'SUPPORTER',
};

const steps = (
  phase: WorkoutStepSeed['phase'],
  rows: Row[],
): WorkoutStepSeed[] =>
  rows.map(([moveCode, seconds, repsText]) => ({
    moveCode,
    phase,
    seconds,
    repsText,
  }));

function workout(
  code: string,
  name: string,
  modality: Modality,
  durationSec: WorkoutSeed['durationSec'],
  spaceNeeded: SpaceRequirement,
  equipment: Equipment[],
  metValue: number,
  sets: number,
  warmup: Row[],
  main: Row[],
  cooldown: Row[],
): WorkoutSeed {
  return {
    code,
    name,
    modality,
    durationSec,
    spaceNeeded,
    equipment,
    metValue,
    sets,
    archetypes: [PREFERRED[modality]],
    steps: [
      ...steps('WARMUP', warmup),
      ...steps('MAIN', main),
      ...steps('COOLDOWN', cooldown),
    ],
  };
}

const HOLD = 'giữ 20 giây, lặp lại';

export const WORKOUTS: WorkoutSeed[] = [
  // ------------------------------------------------ the starter set (PLAN Task 21; frame S18)
  workout(
    'FULL_BODY_EASY',
    'Toàn thân vừa sức',
    'RESISTANCE',
    900,
    'ROOM',
    [],
    4.5,
    3,
    [['XOAY_VAI', 30, '30 giây']],
    [
      ['SQUAT_TAY_TRUOC_NGUC', 90, '12 lần'],
      ['CHONG_DAY_TUA_BAN', 80, '10 lần'],
      ['CHUNG_CHAN_LUI', 90, '8 lần mỗi bên'],
      ['PLANK_TUA_GOI', 20, 'giữ 20 giây'],
    ],
    [['THA_LONG_VAI', 30, '30 giây']],
  ),
  workout(
    'DESK_STRETCH',
    'Giãn cơ bên bàn làm việc',
    'MOBILITY',
    300,
    'DESK_SIDE',
    [],
    2.0,
    2,
    [['XOAY_VAI', 40, '40 giây']],
    [
      ['NGHIENG_CO', 30, '3 lần mỗi bên'],
      ['MO_NGUC', 40, 'giữ 15 giây, lặp lại'],
      ['GIAN_CO_TAY', 30, '12 giây mỗi bên'],
    ],
    [['THA_LONG_VAI', 60, '60 giây']],
  ),
  workout(
    'BREATHE_RELAX',
    'Thở và thả lỏng',
    'BREATHING',
    300,
    'DESK_SIDE',
    [],
    1.2,
    2,
    [['THO_BUNG', 60, '60 giây']],
    [
      ['THO_4_4', 50, '6 nhịp thở'],
      ['THO_RA_DAI', 40, '4 nhịp thở'],
    ],
    [['THA_LONG_VAI', 60, '60 giây']],
  ),
  // ------------------------------------------------ at the desk
  workout(
    'DESK_RESET_15',
    'Làm mới giữa giờ làm việc',
    'MOBILITY',
    900,
    'DESK_SIDE',
    [],
    2.3,
    3,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['NGHIENG_CO', 60, '5 lần mỗi bên'],
    ],
    [
      ['XOAY_THAN_NGOI', 60, '6 lần mỗi bên'],
      ['MO_NGUC', 60, HOLD],
      ['GIAN_LUNG_NGOI', 50, HOLD],
      ['GIAN_CO_TAY', 50, '20 giây mỗi bên'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['THO_BUNG', 60, '60 giây'],
    ],
  ),
  workout(
    'DESK_BREATH_15',
    'Thở sâu giữa giờ làm việc',
    'BREATHING',
    900,
    'DESK_SIDE',
    [],
    1.2,
    3,
    [
      ['THO_BUNG', 60, '60 giây'],
      ['XOAY_VAI', 60, '60 giây'],
    ],
    [
      ['THO_4_4', 60, '7 nhịp thở'],
      ['THO_RA_DAI', 60, '6 nhịp thở'],
      ['THO_VUONG', 50, '3 vòng thở'],
      ['QUET_CO_THE', 50, '50 giây'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['THO_BUNG', 60, '60 giây'],
    ],
  ),
  workout(
    'DESK_CHAIR_STRENGTH_15',
    'Sức mạnh nhẹ với chiếc ghế',
    'RESISTANCE',
    900,
    'DESK_SIDE',
    [],
    3.2,
    3,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['NHON_GOT', 60, '12 lần'],
    ],
    [
      ['DUNG_LEN_NGOI_XUONG', 60, '8 lần'],
      ['CHONG_DAY_TUONG', 60, '8 lần'],
      ['NHON_GOT', 50, '12 lần'],
      ['CHONG_DAY_TUA_BAN', 50, '6 lần'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
    ],
  ),
  workout(
    'DESK_MARCH_5',
    'Đi tại chỗ bên bàn',
    'CARDIO',
    300,
    'DESK_SIDE',
    [],
    4.0,
    2,
    [['XOAY_VAI', 40, '40 giây']],
    [
      ['DI_TAI_CHO', 40, '40 giây'],
      ['NANG_GOI', 30, '30 giây'],
      ['GOT_CHAM_MONG', 30, '30 giây'],
    ],
    [['DI_BO_CHAM', 60, '60 giây']],
  ),
  workout(
    'DESK_STRETCH_30',
    'Giãn cơ buổi chiều',
    'MOBILITY',
    1800,
    'DESK_SIDE',
    [],
    2.4,
    4,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['NGHIENG_CO', 60, '5 lần mỗi bên'],
      ['GIAN_CO_TAY', 60, '25 giây mỗi bên'],
    ],
    [
      ['XOAY_THAN_NGOI', 70, '8 lần mỗi bên'],
      ['MO_NGUC', 70, HOLD],
      ['GIAN_LUNG_NGOI', 70, HOLD],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['THO_BUNG', 100, '100 giây'],
      ['QUET_CO_THE', 100, '100 giây'],
    ],
  ),
  workout(
    'DESK_CALM_30',
    'Thư giãn tại chỗ ngồi',
    'BREATHING',
    1800,
    'DESK_SIDE',
    [],
    1.1,
    4,
    [
      ['THO_BUNG', 90, '90 giây'],
      ['XOAY_VAI', 90, '90 giây'],
    ],
    [
      ['THO_4_4', 70, '8 nhịp thở'],
      ['THO_RA_DAI', 70, '7 nhịp thở'],
      ['THO_VUONG', 70, '4 vòng thở'],
      ['QUET_CO_THE', 60, '60 giây'],
      ['THO_BUNG', 60, '60 giây'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['QUET_CO_THE', 100, '100 giây'],
      ['THO_RA_DAI', 100, '10 nhịp thở'],
    ],
  ),
  workout(
    'DESK_FLOW_45',
    'Giãn cơ và thở tại bàn',
    'MOBILITY',
    2700,
    'DESK_SIDE',
    [],
    2.2,
    5,
    [
      ['XOAY_VAI', 100, '100 giây'],
      ['NGHIENG_CO', 100, '8 lần mỗi bên'],
      ['THO_BUNG', 100, '100 giây'],
    ],
    [
      ['XOAY_THAN_NGOI', 70, '8 lần mỗi bên'],
      ['MO_NGUC', 70, HOLD],
      ['THO_4_4', 70, '8 nhịp thở'],
      ['GIAN_LUNG_NGOI', 70, HOLD],
      ['XOAY_HONG', 70, '8 vòng mỗi chiều'],
      ['THO_RA_DAI', 70, '7 nhịp thở'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['QUET_CO_THE', 100, '100 giây'],
      ['THO_BUNG', 100, '100 giây'],
    ],
  ),
  // ------------------------------------------------ in a room: strength
  workout(
    'ROOM_STRENGTH_5',
    'Sức mạnh nhanh tại nhà',
    'RESISTANCE',
    300,
    'ROOM',
    [],
    3.5,
    2,
    [['XOAY_VAI', 40, '40 giây']],
    [
      ['SQUAT_TAY_TRUOC_NGUC', 30, '8 lần'],
      ['CHONG_DAY_TUONG', 30, '8 lần'],
      ['CAU_MONG', 40, '10 lần'],
    ],
    [['THA_LONG_VAI', 60, '60 giây']],
  ),
  workout(
    'ROOM_STRENGTH_30',
    'Sức mạnh toàn thân',
    'RESISTANCE',
    1800,
    'ROOM',
    [],
    4.0,
    4,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
      ['NHON_GOT', 60, '12 lần'],
    ],
    [
      ['SQUAT_TAY_TRUOC_NGUC', 70, '12 lần'],
      ['CHONG_DAY_TUA_BAN', 70, '8 lần'],
      ['CHUNG_CHAN_LUI', 70, '6 lần mỗi bên'],
      ['CAU_MONG', 60, '12 lần'],
      ['PLANK_TUA_GOI', 60, HOLD],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
    ],
  ),
  workout(
    'ROOM_STRENGTH_45',
    'Nhiều vòng sức mạnh tại nhà',
    'RESISTANCE',
    2700,
    'ROOM',
    [],
    4.2,
    5,
    [
      ['XOAY_VAI', 100, '100 giây'],
      ['XOAY_HONG', 100, '12 vòng mỗi chiều'],
      ['NHON_GOT', 100, '15 lần'],
    ],
    [
      ['SQUAT_TAY_TRUOC_NGUC', 70, '12 lần'],
      ['CHONG_DAY_TUA_BAN', 70, '8 lần'],
      ['CHUNG_CHAN_LUI', 70, '6 lần mỗi bên'],
      ['CAU_MONG', 70, '12 lần'],
      ['TAY_CHAN_DOI_DIEN', 70, '6 lần mỗi bên'],
      ['PLANK_TUA_GOI', 70, HOLD],
    ],
    [
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
      ['THA_LONG_VAI', 100, '100 giây'],
    ],
  ),
  workout(
    'ROOM_DUMBBELL_15',
    'Tạ tay tại nhà',
    'RESISTANCE',
    900,
    'ROOM',
    ['ta-tay'],
    4.5,
    3,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['SQUAT_TA_TAY', 60, '10 lần'],
      ['CHEO_TA_TAY', 60, '8 lần mỗi bên'],
      ['DAY_VAI_TA_TAY', 50, '8 lần'],
      ['CUON_TAY_TA', 50, '10 lần'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
    ],
  ),
  workout(
    'ROOM_BAND_30',
    'Dây kháng lực tại nhà',
    'RESISTANCE',
    1800,
    'ROOM',
    ['day-khang-luc'],
    4.0,
    4,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
      ['NHON_GOT', 60, '12 lần'],
    ],
    [
      ['KEO_DAY_NGANG', 70, '12 lần'],
      ['SQUAT_TAY_TRUOC_NGUC', 70, '12 lần'],
      ['BUOC_NGANG_DAY', 70, '8 bước mỗi hướng'],
      ['CHONG_DAY_TUA_BAN', 60, '8 lần'],
      ['CAU_MONG', 60, '12 lần'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
    ],
  ),
  // ------------------------------------------------ in a room: cardio and intervals
  workout(
    'ROOM_CARDIO_5',
    'Khởi động nhịp tim',
    'CARDIO',
    300,
    'ROOM',
    [],
    4.5,
    2,
    [['XOAY_VAI', 40, '40 giây']],
    [
      ['DI_TAI_CHO', 40, '40 giây'],
      ['NANG_GOI', 30, '30 giây'],
      ['DANG_TAY_BUOC_NGANG', 30, '30 giây'],
    ],
    [['DI_BO_CHAM', 60, '60 giây']],
  ),
  workout(
    'ROOM_CARDIO_15',
    'Cardio nhẹ trong phòng',
    'CARDIO',
    900,
    'ROOM',
    [],
    5.0,
    3,
    [
      ['DI_TAI_CHO', 60, '60 giây'],
      ['XOAY_VAI', 60, '60 giây'],
    ],
    [
      ['NANG_GOI', 60, '60 giây'],
      ['DANG_TAY_BUOC_NGANG', 60, '60 giây'],
      ['GOT_CHAM_MONG', 50, '50 giây'],
      ['DI_TAI_CHO', 50, '50 giây'],
    ],
    [
      ['DI_BO_CHAM', 60, '60 giây'],
      ['THA_LONG_VAI', 60, '60 giây'],
    ],
  ),
  workout(
    'ROOM_CARDIO_30',
    'Cardio đều nhịp trong phòng',
    'CARDIO',
    1800,
    'ROOM',
    [],
    5.5,
    4,
    [
      ['DI_TAI_CHO', 60, '60 giây'],
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['NANG_GOI', 70, '70 giây'],
      ['DANG_TAY_BUOC_NGANG', 70, '70 giây'],
      ['GOT_CHAM_MONG', 70, '70 giây'],
      ['DI_TAI_CHO', 60, '60 giây'],
      ['DANG_TAY_BUOC_NGANG', 60, '60 giây'],
    ],
    [
      ['DI_BO_CHAM', 100, '100 giây'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
      ['THA_LONG_VAI', 100, '100 giây'],
    ],
  ),
  workout(
    'ROOM_HIIT_5',
    'Ngắt quãng rất nhẹ',
    'HIIT',
    300,
    'ROOM',
    [],
    6.0,
    3,
    [
      ['XOAY_VAI', 30, '30 giây'],
      ['DI_TAI_CHO', 30, '30 giây'],
    ],
    [
      ['NHUN_NHE', 30, '30 giây'],
      ['DI_BO_CHAM', 30, 'nghỉ 30 giây'],
    ],
    [['DI_BO_CHAM', 60, '60 giây']],
  ),
  workout(
    'ROOM_HIIT_15',
    'Ngắt quãng nhẹ',
    'HIIT',
    900,
    'ROOM',
    [],
    6.0,
    3,
    [
      ['DI_TAI_CHO', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['NANG_GOI', 50, 'nhanh 30 giây, nhẹ 20 giây'],
      ['DI_TAI_CHO', 40, 'nghỉ 40 giây'],
      ['DANG_TAY_BUOC_NGANG', 50, 'nhanh 30 giây, nhẹ 20 giây'],
      ['DI_TAI_CHO', 40, 'nghỉ 40 giây'],
      ['NHUN_NHE', 40, 'nhanh 30 giây, nhẹ 10 giây'],
    ],
    [
      ['DI_BO_CHAM', 60, '60 giây'],
      ['THA_LONG_VAI', 60, '60 giây'],
    ],
  ),
  workout(
    'ROOM_HIIT_30',
    'Ngắt quãng vừa sức',
    'HIIT',
    1800,
    'ROOM',
    [],
    6.0,
    4,
    [
      ['DI_TAI_CHO', 60, '60 giây'],
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['NHUN_NHE', 60, 'nhanh 40 giây, nhẹ 20 giây'],
      ['DI_TAI_CHO', 50, 'nghỉ 50 giây'],
      ['NANG_GOI', 70, 'nhanh 40 giây, nhẹ 30 giây'],
      ['DANG_TAY_BUOC_NGANG', 70, 'nhanh 40 giây, nhẹ 30 giây'],
      ['DI_TAI_CHO', 40, 'nghỉ 40 giây'],
      ['LEO_NUI_TUA_BAN', 40, '30 giây, nghỉ 10 giây'],
    ],
    [
      ['DI_BO_CHAM', 100, '100 giây'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
      ['THA_LONG_VAI', 100, '100 giây'],
    ],
  ),
  // ------------------------------------------------ in a room: mobility and breathing
  workout(
    'ROOM_MOBILITY_5',
    'Mở người buổi sáng',
    'MOBILITY',
    300,
    'ROOM',
    [],
    2.2,
    2,
    [['XOAY_VAI', 40, '40 giây']],
    [
      ['MEO_BO', 30, '5 lần'],
      ['XOAY_HONG', 30, '5 vòng mỗi chiều'],
      ['GIAN_DUI_TRUOC', 40, '15 giây mỗi bên'],
    ],
    [['THO_BUNG', 60, '60 giây']],
  ),
  workout(
    'ROOM_MOBILITY_15',
    'Giãn cơ nhẹ toàn thân',
    'MOBILITY',
    900,
    'ROOM',
    [],
    2.5,
    3,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['XOAY_THAN_NGOI', 60, '8 lần mỗi bên'],
      ['GIAN_DUI_TRUOC', 60, '25 giây mỗi bên'],
      ['MO_NGUC', 50, HOLD],
      ['GIAN_BAP_CHAN', 50, '20 giây mỗi bên'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['THO_BUNG', 60, '60 giây'],
    ],
  ),
  workout(
    'ROOM_MOBILITY_30',
    'Giãn cơ toàn thân',
    'MOBILITY',
    1800,
    'ROOM',
    [],
    2.5,
    4,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['NGHIENG_CO', 60, '5 lần mỗi bên'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['MEO_BO', 70, '8 lần'],
      ['GIAN_DUI_TRUOC', 70, '30 giây mỗi bên'],
      ['MO_NGUC', 70, HOLD],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
      ['XOAY_THAN_NGOI', 60, '6 lần mỗi bên'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['THO_BUNG', 100, '100 giây'],
      ['QUET_CO_THE', 100, '100 giây'],
    ],
  ),
  workout(
    'ROOM_BREATH_15',
    'Thở chậm trước giờ ngủ',
    'BREATHING',
    900,
    'ROOM',
    [],
    1.1,
    3,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['THO_BUNG', 60, '60 giây'],
    ],
    [
      ['THO_4_4', 60, '7 nhịp thở'],
      ['THO_RA_DAI', 60, '6 nhịp thở'],
      ['QUET_CO_THE', 50, '50 giây'],
      ['THO_VUONG', 50, '3 vòng thở'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['THO_BUNG', 60, '60 giây'],
    ],
  ),
  // ------------------------------------------------ at the gym
  workout(
    'GYM_STRENGTH_15',
    'Sức mạnh cơ bản ở phòng tập',
    'RESISTANCE',
    900,
    'GYM',
    ['ta-tay'],
    5.0,
    3,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['SQUAT_TA_TAY', 60, '10 lần'],
      ['GAP_HONG_TA_TAY', 60, '10 lần'],
      ['DAY_VAI_TA_TAY', 50, '8 lần'],
      ['CHUNG_CHAN_LUI', 50, '6 lần mỗi bên'],
    ],
    [
      ['THA_LONG_VAI', 60, '60 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
    ],
  ),
  workout(
    'GYM_DUMBBELL_30',
    'Tạ tay ở phòng tập',
    'RESISTANCE',
    1800,
    'GYM',
    ['ta-tay'],
    5.0,
    4,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
      ['NHON_GOT', 60, '12 lần'],
    ],
    [
      ['SQUAT_TA_TAY', 70, '10 lần'],
      ['CHEO_TA_TAY', 70, '8 lần mỗi bên'],
      ['DAY_VAI_TA_TAY', 70, '8 lần'],
      ['GAP_HONG_TA_TAY', 60, '10 lần'],
      ['CUON_TAY_TA', 60, '10 lần'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
    ],
  ),
  workout(
    'GYM_BAND_30',
    'Dây kháng lực ở phòng tập',
    'RESISTANCE',
    1800,
    'GYM',
    ['day-khang-luc'],
    4.5,
    4,
    [
      ['XOAY_VAI', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
      ['NHON_GOT', 60, '12 lần'],
    ],
    [
      ['KEO_DAY_NGANG', 70, '12 lần'],
      ['BUOC_NGANG_DAY', 70, '8 bước mỗi hướng'],
      ['SQUAT_TAY_TRUOC_NGUC', 70, '12 lần'],
      ['CHONG_DAY_TUA_BAN', 60, '8 lần'],
      ['TAY_CHAN_DOI_DIEN', 60, '6 lần mỗi bên'],
    ],
    [
      ['THA_LONG_VAI', 100, '100 giây'],
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
    ],
  ),
  workout(
    'GYM_DUMBBELL_45',
    'Tạ tay toàn thân',
    'RESISTANCE',
    2700,
    'GYM',
    ['ta-tay'],
    5.0,
    5,
    [
      ['DI_TAI_CHO', 100, '100 giây'],
      ['XOAY_VAI', 100, '100 giây'],
      ['XOAY_HONG', 100, '12 vòng mỗi chiều'],
    ],
    [
      ['SQUAT_TA_TAY', 70, '10 lần'],
      ['CHEO_TA_TAY', 70, '8 lần mỗi bên'],
      ['DAY_VAI_TA_TAY', 70, '8 lần'],
      ['GAP_HONG_TA_TAY', 70, '10 lần'],
      ['CUON_TAY_TA', 70, '10 lần'],
      ['CHUNG_CHAN_LUI', 70, '6 lần mỗi bên'],
    ],
    [
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
      ['THA_LONG_VAI', 100, '100 giây'],
    ],
  ),
  workout(
    'GYM_CIRCUIT_45',
    'Vòng tập tạ tay và dây',
    'RESISTANCE',
    2700,
    'GYM',
    ['ta-tay', 'day-khang-luc'],
    5.5,
    5,
    [
      ['DI_TAI_CHO', 100, '100 giây'],
      ['XOAY_VAI', 100, '100 giây'],
      ['XOAY_HONG', 100, '12 vòng mỗi chiều'],
    ],
    [
      ['SQUAT_TA_TAY', 70, '10 lần'],
      ['KEO_DAY_NGANG', 70, '12 lần'],
      ['DAY_VAI_TA_TAY', 70, '8 lần'],
      ['BUOC_NGANG_DAY', 70, '8 bước mỗi hướng'],
      ['GAP_HONG_TA_TAY', 70, '10 lần'],
      ['PLANK_TUA_GOI', 70, HOLD],
    ],
    [
      ['GIAN_DUI_TRUOC', 100, '45 giây mỗi bên'],
      ['GIAN_BAP_CHAN', 100, '45 giây mỗi bên'],
      ['THA_LONG_VAI', 100, '100 giây'],
    ],
  ),
  // ------------------------------------------------ outdoors
  workout(
    'OUT_BREATH_5',
    'Thở giữa không khí thoáng',
    'BREATHING',
    300,
    'OUTDOOR',
    [],
    1.2,
    2,
    [['DI_BO_CHAM', 40, '40 giây']],
    [
      ['THO_4_4', 40, '5 nhịp thở'],
      ['THO_RA_DAI', 30, '3 nhịp thở'],
      ['THO_BUNG', 30, '30 giây'],
    ],
    [['QUET_CO_THE', 60, '60 giây']],
  ),
  workout(
    'OUT_WALK_15',
    'Đi bộ nhanh quanh khu phố',
    'CARDIO',
    900,
    'OUTDOOR',
    [],
    4.0,
    3,
    [
      ['DI_BO_CHAM', 60, '60 giây'],
      ['XOAY_VAI', 60, '60 giây'],
    ],
    [
      ['DI_BO_NHANH', 120, '120 giây'],
      ['DI_BO_CHAM', 100, '100 giây'],
    ],
    [
      ['DI_BO_CHAM', 60, '60 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
    ],
  ),
  workout(
    'OUT_WALK_30',
    'Đi bộ nhanh ngoài trời',
    'CARDIO',
    1800,
    'OUTDOOR',
    [],
    4.0,
    4,
    [
      ['DI_BO_CHAM', 120, '120 giây'],
      ['XOAY_VAI', 60, '60 giây'],
    ],
    [
      ['DI_BO_NHANH', 200, '200 giây'],
      ['DI_BO_CHAM', 130, '130 giây'],
    ],
    [
      ['DI_BO_CHAM', 150, '150 giây'],
      ['GIAN_BAP_CHAN', 75, '35 giây mỗi bên'],
      ['GIAN_DUI_TRUOC', 75, '35 giây mỗi bên'],
    ],
  ),
  workout(
    'OUT_JOG_30',
    'Chạy bộ nhẹ xen đi bộ',
    'CARDIO',
    1800,
    'OUTDOOR',
    [],
    4.0,
    4,
    [
      ['DI_BO_NHANH', 120, '120 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['CHAY_BO_NHE', 90, '90 giây'],
      ['DI_BO_NHANH', 240, '240 giây'],
    ],
    [
      ['DI_BO_CHAM', 180, '180 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
      ['GIAN_DUI_TRUOC', 60, '25 giây mỗi bên'],
    ],
  ),
  workout(
    'OUT_INTERVAL_15',
    'Đi nhanh xen chạy nhẹ',
    'HIIT',
    900,
    'OUTDOOR',
    [],
    6.0,
    3,
    [
      ['DI_BO_NHANH', 60, '60 giây'],
      ['XOAY_HONG', 60, '8 vòng mỗi chiều'],
    ],
    [
      ['CHAY_BO_NHE', 40, '40 giây'],
      ['DI_BO_CHAM', 60, '60 giây'],
      ['CHAY_BO_NHE', 40, '40 giây'],
      ['DI_BO_CHAM', 80, '80 giây'],
    ],
    [
      ['DI_BO_CHAM', 60, '60 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
    ],
  ),
  workout(
    'OUT_WALK_45',
    'Đi bộ đều nhịp ngoài trời',
    'CARDIO',
    2700,
    'OUTDOOR',
    [],
    4.5,
    5,
    [
      ['DI_BO_CHAM', 240, '240 giây'],
      ['XOAY_VAI', 60, '60 giây'],
    ],
    [
      ['DI_BO_NHANH', 280, '280 giây'],
      ['DI_BO_CHAM', 140, '140 giây'],
    ],
    [
      ['DI_BO_CHAM', 180, '180 giây'],
      ['GIAN_BAP_CHAN', 60, '25 giây mỗi bên'],
      ['GIAN_DUI_TRUOC', 60, '25 giây mỗi bên'],
    ],
  ),
];
