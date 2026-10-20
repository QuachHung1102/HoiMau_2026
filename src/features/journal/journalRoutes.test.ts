import { detailScreens } from '../../app/screens';

// The seven routes of this feature are registered in the stack of the tab they were opened from. Each is reached from a real
// screen in the other tests: the profile row ("Góc giải tỏa"), the journey row ("Vé giữ nhịp"), the "Những trang đã viết" link,
// a list row, "Xem vé" and "Xem nguồn hỗ trợ" on S33, "Xem trước việc dùng vé" on S34.
test('the journal and ticket routes are registered', () => {
  const names = detailScreens.map(entry => entry.name);
  for (const name of ['JournalWrite', 'JournalFeedback', 'Support', 'JournalList', 'JournalEntry', 'Tickets', 'TicketPreview']) {
    expect(names.filter(registered => registered === name)).toEqual([name]);
  }
});
