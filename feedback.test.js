/**
 * @jest-environment jsdom
 */
const { submitFeedback, toggleManualFeedback } = require('./mapTest');

global.navigator = {};
global.navigator.geolocation = {
    getCurrentPosition: jest.fn((success) => {
        success({ coords: { latitude: -26.2041, longitude: 28.0473 } });
    })
};

describe('Feedback Functions', () => {
  test('submitFeedback adds feedback to recentReports', () => {
    global.navigator.geolocation = {
      getCurrentPosition: jest.fn((success) => {
        success({ coords: { latitude: -26.2041, longitude: 28.0473 } });
      }),
    };

    const mockCreateOrUpdateDangerZone = jest.fn();
    const mockUpdateReportsTable = jest.fn();

    global.createOrUpdateDangerZone = mockCreateOrUpdateDangerZone;
    global.updateReportsTable = mockUpdateReportsTable;

    submitFeedback('Unsafe area');

    expect(mockCreateOrUpdateDangerZone).toHaveBeenCalledWith(
      -26.2041,
      28.0473,
      'Unsafe area',
      '-26.204100, 28.047300'
    );
    expect(mockUpdateReportsTable).toHaveBeenCalled();
  });

  test('toggleManualFeedback toggles visibility of feedback banner', () => {
    document.body.innerHTML = '<div id="manual-feedback-banner" class="hidden"></div>';

    toggleManualFeedback();

    const banner = document.getElementById('manual-feedback-banner');
    expect(banner.classList.contains('hidden')).toBe(false);

    toggleManualFeedback();
    expect(banner.classList.contains('hidden')).toBe(true);
  });
});
