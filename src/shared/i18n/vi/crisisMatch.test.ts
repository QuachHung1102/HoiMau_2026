import { matchesCrisis } from './crisisMatch';

// Policy: favour recall for direct first-person statements; for everything else routine writing wins.
// A false positive only shows a gentle support block, a miss shows nothing to someone who needed it.
// Matching is per clause (split on . , ; : ! ? … and line breaks), so "Muốn chết quá" matches while
// "Mệt muốn chết quá" does not. Four tables, read them as a reviewer:
//   mustMatch               crisis statements, many also typed without diacritics
//   mustNotMatch            routine health-app writing and idioms
//   acceptedFalsePositives  fire by design: recall beat routine noise, anchors could not separate them
//   knownMisses             do NOT match: indirect signals, punctuation-split phrases, ambiguous unaccented text

// "tự vẫn" has no unaccented twin: "tu van" (tư vấn) is far too common.
const mustMatch: string[] = [
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
  // review round 2: direct statements that were missed
  'Con muon chet',
  'Cháu muốn chết',
  'Tớ muốn chết',
  'Chán đời, muốn chết',
  'Chan doi, muon chet',
  'Mình đã quá mệt mỏi rồi, muốn chết thôi',
  'Minh da qua met moi roi, muon chet thoi',
  'Chết quách đi cho rồi',
  'Chet quach di cho roi',
  'Mình thà chết còn hơn sống thế này',
  'Minh tha chet con hon song the nay',
  'Sống thế này thà chết đi còn hơn',
  'Mình muốn treo cổ',
  'Minh muon treo co',
  'Mình muốn nhảy cầu',
  'Minh muon nhay cau',
  'Em muốn nhảy xuống sông',
  'Em muon nhay xuong song',
  'Tôi định uống thuốc diệt cỏ',
  'Toi dinh uong thuoc diet co',
  'Mình muốn uống cả vỉ thuốc ngủ',
  'Minh muon uong ca vi thuoc ngu',
  'Mình hay tự làm mình đau',
  'Minh hay tu lam minh dau',
  'Em lại rạch tay',
  'Em lai rach tay',
  'Mình cứa vào tay cho đỡ',
  'Minh cua vao tay cho do',
  'Mình tự cắt vào tay',
  'Minh tu cat vao tay',
  'Mình hết chịu nổi rồi',
  'Minh het chiu noi roi',
  'Không còn lối thoát nào nữa',
  'Khong con loi thoat nao nua',
  'Mình muốn buông xuôi tất cả',
  'Minh muon buong xuoi tat ca',
  'Đừng bao giờ dậy nữa thì tốt',
  'Dung bao gio day nua thi tot',
  'Ước gì mình không bao giờ tỉnh lại',
  'Uoc gi minh khong bao gio tinh lai',
  'Em thấy mình là gánh nặng cho gia đình',
  'Em thay minh la ganh nang cho gia dinh',
  'Mình chết đi thì mọi người nhẹ gánh',
  'Minh chet di thi moi nguoi nhe ganh',
  'Mình chết đi cũng không ai buồn',
  'Minh chet di cung khong ai buon',
  'Mình muốn tự tử, tế nhị mà nói thì đúng vậy',
  'Minh muon tu tu, te nhi ma noi thi dung vay',
  'Mình lại cắt tay. Áo dính máu',
  'Minh lai cat tay. Ao dinh mau',
  // punctuation, newlines, upper case, odd spacing
  'TÔI KHÔNG MUỐN SỐNG!!!',
  'Hôm nay mệt lắm...\nMình không thiết sống nữa.\nKhông biết nói với ai',
  'Không muốn sống nữa, thật sự.',
  '"Tôi muốn nhảy lầu", mình viết ra rồi thấy sợ',
  'TỰ TỬ',
  '  Mình   muốn \t tự vẫn  ',
  'Hôm nay ổn.\r\nMuốn chết',
];

const mustNotMatch: string[] = [
  // the suffix idioms and "từ từ" / "tư vấn"
  'Mệt muốn chết quá',
  'Buồn ngủ muốn chết luôn',
  'Đói muốn chết luôn',
  'Đau bụng muốn chết đi',
  'Hôm nay mệt muốn chết',
  'Hôm nay mệt muốn chết quá',
  'Cười muốn chết đi',
  'Đau chân muốn xỉu',
  'Cười chết mất',
  'Đói chết đi được',
  'Mệt chết đi được',
  'Chết đói rồi',
  'Mình muốn từ từ giảm cân',
  'Minh muon tu tu giam can',
  'muon tu tu giam can',
  'Tôi muốn từ từ thôi',
  'Từ từ rồi tính',
  'Mình nghĩ đến chuyện từ từ giảm đường',
  'Mai minh se tu tu chay bo',
  'minh dinh tu tu tang ta',
  'Mình cần tư vấn bác sĩ',
  'Mình muốn tư vấn dinh dưỡng',
  // sleep and medication
  'Sáng nay ngủ mãi không dậy nổi',
  'Ngủ một giấc không dậy nổi',
  'Sáng nay lạnh quá không muốn dậy',
  'Tối qua uống thuốc ngủ nên dậy muộn',
  'Mình uống thuốc ngủ theo toa, ngủ ngon hơn',
  'Mình uống thuốc cảm rồi',
  'Uống hết lọ thuốc ho',
  'Uống thật nhiều thuốc theo toa',
  'Mình muốn ngủ một giấc thật dài',
  'Mình muốn uống thêm nước',
  // hands, cuts, jumps, ropes
  'Cắt móng tay',
  'Cắt tay áo cho gọn',
  'Áo bị rách tay',
  'Mình lỡ cắt tay khi thái rau',
  'Lỡ cắt vào tay khi thái rau',
  'Mình đi cắt tóc',
  'Tập cẩn thận để không làm đau bản thân',
  'Mình nhảy dây 15 phút',
  'Mình nhảy lâu hơn hôm qua',
  'Mình muốn nhảy lâu hơn khi tập dây',
  'Mình thích nhảy cầu ở hồ bơi',
  'Mình muốn treo cờ ngày lễ',
  // "hết chịu nổi"
  'Nóng hết chịu nổi',
  'Nóng hết chịu nổi rồi',
  'Đau cơ hết chịu nổi sau buổi tập',
  'Hôm nay mình hết chịu nổi cái nóng',
  // ordinary tired, stressed, sad-but-not-crisis lines
  'Hôm nay mình ngủ muộn nên hơi mệt',
  'Công việc áp lực quá, mình hơi căng thẳng',
  'Mình buồn vì bị bạn từ chối',
  'Hôm nay không muốn tập, nhưng vẫn đi bộ 10 phút',
  'Muốn ăn phở quá',
  'Tôi muốn ngủ sớm',
  'Mình muốn sống lành mạnh hơn',
  'Mình muốn sống khỏe để chơi với con',
  'Mình không muốn bỏ cuộc',
  'Hôm nay không muốn ăn sáng',
  'Mụn biến mất rồi, vui quá',
  'Mong mụn biến mất trước kỳ nghỉ',
  'Đau chân sống lưng cũng mỏi',
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

// Fire by design (policy above): an idiom or ambiguous phrase that cannot be separated from a direct
// statement by an anchor, or a word-boundary collision.
const acceptedFalsePositives: string[] = [
  'Mình muốn chết vì xấu hổ khi nói nhầm',
  'Tôi muốn chết ngất vì buồn cười',
  'Mệt quá. Muốn chết luôn',
  'Nóng quá, em hết chịu nổi rồi',
  'Mình thà chết đói còn hơn ăn món này',
  'Mình không muốn sống ở thành phố này nữa',
  'Cuối tuần mình muốn ngủ mãi cho đã',
  'Mình muốn nhảy cầu ở hồ bơi',
  'Mình uống cả vỉ thuốc kháng sinh rồi',
  // "tử tế" is a word of its own, so a word boundary cannot tell it from "tự tử"
  'Anh ấy muốn tự tử tế hơn',
  // unaccented "se tu tu" at a clause end is "sẽ tự tử" or "sẽ từ từ"; recall wins
  'Ok, minh se tu tu.',
];

// Not caught, asserted so the reviewer sees the edge. Indirect signals are not chased.
const knownMisses: string[] = [
  'Tạm biệt tất cả, mình đi đây',
  'Mình đã viết di chúc',
  'Mình hết hy vọng rồi',
  'Tôi muốn uống thật nhiều thuốc',
  // split by punctuation: each clause is matched alone
  'mình... muốn... chết... quá',
  'Mình muốn tự... tử',
  // unaccented, identical to everyday text ("định từ từ", "tư vấn")
  'Minh dinh tu tu toi nay',
  'Minh muon tu van',
];

describe('matchesCrisis', () => {
  test.each(mustMatch)('matches crisis sentence: %j', text => {
    expect(matchesCrisis(text)).toBe(true);
  });

  test.each(mustNotMatch)('does not match everyday sentence: %j', text => {
    expect(matchesCrisis(text)).toBe(false);
  });

  test.each(acceptedFalsePositives)('accepted false positive: %j', text => {
    expect(matchesCrisis(text)).toBe(true);
  });

  test.each(knownMisses)('known miss: %j', text => {
    expect(matchesCrisis(text)).toBe(false);
  });

  test('the tables are large enough', () => {
    expect(mustMatch.length).toBeGreaterThanOrEqual(35);
    expect(mustNotMatch.length).toBeGreaterThanOrEqual(45);
  });

  test('the clause decides: clause-initial and suffix forms differ', () => {
    expect(matchesCrisis('Muốn chết quá')).toBe(true);
    expect(matchesCrisis('Mệt muốn chết quá')).toBe(false);
    expect(matchesCrisis('toi muon tu tu.')).toBe(true);
    expect(matchesCrisis('toi muon tu tu giam can')).toBe(false);
  });

  test('a very long text is matched quickly', () => {
    const oneClause = 'từ từ mình muốn đi bộ nhẹ nhàng '.repeat(3200);
    const manyClauses = 'hôm nay mình đi bộ, uống nước. '.repeat(3300);
    expect(oneClause.length).toBeGreaterThan(100000);
    expect(manyClauses.length).toBeGreaterThan(100000);
    for (const text of [oneClause, manyClauses]) {
      const started = Date.now();
      expect(matchesCrisis(text)).toBe(false);
      expect(Date.now() - started).toBeLessThan(500);
    }
  });
});
