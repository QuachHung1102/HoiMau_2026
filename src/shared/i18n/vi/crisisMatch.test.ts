import { matchesCrisis } from './crisisMatch';

// Policy: favour recall. A false positive only shows a gentle support block; a miss shows nothing to
// someone who needed it. So some everyday sentences fire by design (third table), but a phrase that
// fires on routine health-app writing must not be in the lists (second table).

// Each must match. Typed without diacritics where a person plausibly would; "tự vẫn" has no unaccented
// twin because "tu van" (tư vấn) is far too common.
const crisis: string[] = [
  'Tôi hay cắt tay để đỡ đau',
  'Toi hay cat tay de do dau',
  'Sống chẳng còn ý nghĩa gì nữa',
  'Song chang con y nghia gi nua',
  'Mình không thiết sống nữa',
  'Minh khong thiet song nua',
  'Mình thấy mình không đáng sống',
  'Minh thay minh khong dang song',
  'Giá như mình không tỉnh dậy nữa',
  'Gia nhu minh khong tinh day nua',
  'Mình muốn ngủ mãi không dậy nữa',
  'Minh muon ngu mai khong day nua',
  'Tôi muốn kết liễu đời mình',
  'Toi muon ket lieu doi minh',
  'Tôi muốn nhảy lầu',
  'Toi muon nhay lau',
  'Tôi muốn uống thuốc ngủ cho hết',
  'Toi muon uong thuoc ngu cho het',
  'Cuộc đời này không còn gì cho mình nữa',
  'Cuoc doi nay khong con gi cho minh nua',
  'Mình mong mình biến mất khỏi thế giới này',
  'Minh mong minh bien mat khoi the gioi nay',
  'Tôi muốn tự vẫn',
  'Muốn chết quá',
  'Muon chet qua',
  'Tôi không muốn sống',
  'Toi khong muon song',
  'Mình chỉ muốn chết',
  'Minh chi muon chet',
  'Tôi chẳng muốn sống nữa',
  'Toi chang muon song nua',
  'Mình muốn tự tử',
  'Minh muon tu tu',
  'Tôi đang nghĩ đến chuyện tự tử.',
  'Minh dinh tu tu toi nay',
  'Mình sẽ tự tử',
  'Mình hết muốn sống rồi',
  'Chán sống quá',
  'Tôi muốn tự sát',
  'Mình muốn kết thúc cuộc đời',
  'Mình không còn lý do để sống',
  'Mình chỉ là gánh nặng cho mọi người',
  'Mọi người sẽ tốt hơn nếu không có mình',
  'Mình tự làm đau bản thân',
  'Mình muốn chết đi cho xong',
  'Tôi muốn uống thật nhiều thuốc',
  // punctuation, newlines, upper case
  'TÔI KHÔNG MUỐN SỐNG!!!',
  'Hôm nay mệt lắm...\nMình không thiết sống nữa.\nKhông biết nói với ai',
  'mình... muốn... chết... quá',
  'Không muốn sống nữa, thật sự.',
  '"Tôi muốn nhảy lầu", mình viết ra rồi thấy sợ',
  'TỰ TỬ',
  '  Mình   muốn \t tự vẫn  ',
];

// Each must NOT match: routine health-app writing and idioms.
const everyday: string[] = [
  'Mình muốn từ từ giảm cân',
  'Tôi muốn từ từ thôi',
  'Từ từ rồi tính',
  'Mình nghĩ đến chuyện từ từ giảm đường',
  'Anh ấy muốn tự tử tế hơn',
  'Mình cần tư vấn bác sĩ',
  'Mình muốn tư vấn dinh dưỡng',
  'Hôm nay mệt muốn chết',
  'Đau chân muốn xỉu',
  'Cười chết mất',
  'Đói chết đi được',
  'Chết đói rồi',
  'Mệt chết đi được',
  'Tối qua uống thuốc ngủ nên dậy muộn',
  'Mình uống thuốc ngủ theo toa, ngủ ngon hơn',
  'Mình uống thuốc cảm rồi',
  'Cắt móng tay',
  'Cắt tay áo cho gọn',
  'Mình đi cắt tóc',
  'Hôm nay mình ngủ muộn nên hơi mệt',
  'Công việc áp lực quá, mình hơi căng thẳng',
  'Mình buồn vì bị bạn từ chối',
  'Hôm nay không muốn tập, nhưng vẫn đi bộ 10 phút',
  'Mình muốn uống thêm nước',
  'Muốn ăn phở quá',
  'Tôi muốn ngủ sớm',
  'Mình muốn sống lành mạnh hơn',
  'Mình muốn sống khỏe để chơi với con',
  'Mình không muốn bỏ cuộc',
  'Hôm nay không muốn ăn sáng',
  'Mình muốn ngủ một giấc thật dài',
  'Mụn biến mất rồi, vui quá',
  'Mong mụn biến mất trước kỳ nghỉ',
  'Đau chân sống lưng cũng mỏi',
  'Tập cẩn thận để không làm đau bản thân',
  'Mình nhảy dây 15 phút',
  'Mình nhảy lâu hơn hôm qua',
  'Mình muốn nhảy lâu hơn khi tập dây',
  'Mình thích nhảy cầu ở hồ bơi',
  'Tối nay mình ăn cơm với bố mẹ',
  'Hôm nay chán quá, không muốn làm gì',
  'Mình thấy kiệt sức',
  'Mình lo lắng về buổi phỏng vấn',
  'Mình khóc một chút rồi thấy nhẹ hơn',
  'Hôm nay mình nhớ bố, bố mình mất năm ngoái',
  'Cuộc sống bận rộn nhưng vui',
  'Cuộc đời này đẹp quá',
  'Cuộc sống không có gì thay đổi',
  'Mình nghĩ về ý nghĩa của việc tập luyện',
  'Mình đang sống ở Hà Nội',
  'Mình không đang sống cùng bố mẹ',
  'Bài tập này rất đáng làm',
  'Chuyến đi này không đáng tiền',
  'Hôm nay mình đã uống đủ 8 ly nước',
  '',
  '   ',
];

// Fire by design (see the policy above): idioms and ambiguous phrases kept for recall.
const acceptedFalsePositives: string[] = [
  'Mình muốn chết vì xấu hổ khi nói nhầm',
  'Hôm nay mệt muốn chết quá',
  'Tôi muốn chết ngất vì buồn cười',
  'Cười muốn chết đi',
  'Mình không muốn sống ở thành phố này nữa',
  'Mình lỡ cắt tay khi thái rau',
  'Minh muon tu tu giam can',
];

describe('matchesCrisis', () => {
  test.each(crisis)('matches crisis sentence: %j', text => {
    expect(matchesCrisis(text)).toBe(true);
  });

  test.each(everyday)('does not match everyday sentence: %j', text => {
    expect(matchesCrisis(text)).toBe(false);
  });

  test.each(acceptedFalsePositives)('accepted false positive: %j', text => {
    expect(matchesCrisis(text)).toBe(true);
  });

  test('the tables are large enough', () => {
    expect(crisis.length).toBeGreaterThanOrEqual(35);
    expect(everyday.length).toBeGreaterThanOrEqual(45);
  });
});
