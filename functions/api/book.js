const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const MAX_TEXT_LENGTH = 2000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function isValidTimeZone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch (error) { return false; }
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += desired - represented;
  }
  const finalParts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  if (Number(finalParts.year) !== year || Number(finalParts.month) !== month || Number(finalParts.day) !== day || Number(finalParts.hour) !== hour || Number(finalParts.minute) !== minute) return null;
  return new Date(guess);
}

function validateBooking(input, consultantTimeZone) {
  const booking = {
    customerName: cleanText(input.customerName, 120),
    customerEmail: cleanText(input.customerEmail, 254).toLowerCase(),
    consultation: cleanText(input.consultation, 160),
    bookingDate: cleanText(input.bookingDate, 10),
    startTime: cleanText(input.startTime, 5),
    endTime: cleanText(input.endTime, 5),
    customerTimeZone: cleanText(input.customerTimeZone, 100),
    bookingGoal: cleanText(input.bookingGoal, 1000),
    message: cleanText(input.message, MAX_TEXT_LENGTH)
  };
  const errors = [];
  if (booking.customerName.length < 2) errors.push('Customer name is required.');
  if (!isValidEmail(booking.customerEmail)) errors.push('A valid customer email is required.');
  if (!booking.consultation) errors.push('Consultation is required.');
  if (!booking.bookingGoal) errors.push('Booking goal is required.');
  if (!isRealDate(booking.bookingDate)) errors.push('Booking date must be a valid YYYY-MM-DD date.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.startTime)) errors.push('Start time must use 24-hour HH:MM format.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.endTime)) errors.push('End time must use 24-hour HH:MM format.');
  if (!isValidTimeZone(booking.customerTimeZone)) errors.push('Customer time zone is invalid.');
  if (!isValidTimeZone(consultantTimeZone)) errors.push('Consultant time zone is not configured correctly.');
  if (errors.length) return { errors };
  const start = localDateTimeToUtc(booking.bookingDate, booking.startTime, consultantTimeZone);
  const end = localDateTimeToUtc(booking.bookingDate, booking.endTime, consultantTimeZone);
  if (!start || !end || end <= start) errors.push('The booking time range is invalid.');
  if (start && start <= new Date()) errors.push('The booking time must be in the future.');
  if (start && end && end - start !== 60 * 60 * 1000) errors.push('The consultation must be 60 minutes.');
  const dayOfWeek = new Date(booking.bookingDate + 'T00:00:00Z').getUTCDay();
  const offeredSlots = dayOfWeek === 0 ? [] : dayOfWeek === 6 ? ['10:00', '12:00'] : dayOfWeek === 5 ? ['09:00', '11:00', '13:00'] : ['09:00', '11:00', '14:00', '16:00'];
  if (!offeredSlots.includes(booking.startTime)) errors.push('The selected time is not an offered booking slot.');
  return errors.length ? { errors } : { booking, start, end };
}

async function googleRequest(url, options, accessToken) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
  });
  let body = {};
  try { body = await response.json(); } catch (error) {}
  if (!response.ok) throw new Error(`Google Calendar request failed (${response.status}): ${body.error?.message || 'Unknown error'}`);
  return body;
}

async function getAccessToken(env) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Google OAuth token refresh failed (${response.status}).`);
  return body.access_token;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const requiredVariables = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID', 'CONSULTANT_TIME_ZONE'];
  if (requiredVariables.some((key) => !env[key])) return jsonResponse({ error: 'Booking service is not configured.' }, 503);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return jsonResponse({ error: 'Content-Type must be application/json.' }, 415);
  let input;
  try { input = await request.json(); } catch (error) { return jsonResponse({ error: 'Request body must be valid JSON.' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return jsonResponse({ error: 'Invalid booking information.' }, 400);
  const validated = validateBooking(input, env.CONSULTANT_TIME_ZONE);
  if (validated.errors) return jsonResponse({ error: validated.errors[0], errors: validated.errors }, 400);
  const { booking, start, end } = validated;
  try {
    const accessToken = await getAccessToken(env);
    const availability = await googleRequest(`${GOOGLE_CALENDAR_API}/freeBusy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: env.GOOGLE_CALENDAR_ID }] })
    }, accessToken);
    const calendarAvailability = availability.calendars?.[env.GOOGLE_CALENDAR_ID];
    if (!calendarAvailability || calendarAvailability.errors?.length) throw new Error('Google Calendar availability could not be verified.');
    if (calendarAvailability.busy?.length) return jsonResponse({ error: 'The selected date and time are no longer available.' }, 409);
    const description = [
      `Customer: ${booking.customerName}`,
      `Customer email: ${booking.customerEmail}`,
      `Customer time zone: ${booking.customerTimeZone}`,
      booking.bookingGoal ? `Booking goal: ${booking.bookingGoal}` : '',
      booking.message ? `Message:\n${booking.message}` : ''
    ].filter(Boolean).join('\n\n');
    const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID);
    const event = await googleRequest(`${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events?sendUpdates=all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: booking.consultation,
        description,
        start: { dateTime: `${booking.bookingDate}T${booking.startTime}:00`, timeZone: env.CONSULTANT_TIME_ZONE },
        end: { dateTime: `${booking.bookingDate}T${booking.endTime}:00`, timeZone: env.CONSULTANT_TIME_ZONE },
        attendees: [{ email: booking.customerEmail, displayName: booking.customerName }],
        guestsCanInviteOthers: false,
        extendedProperties: { private: { source: 'e4la-website', customerTimeZone: booking.customerTimeZone } }
      })
    }, accessToken);
    return jsonResponse({
      eventId: event.id,
      iCalUID: event.iCalUID,
      startTime: new Date(event.start.dateTime).toISOString(),
      endTime: new Date(event.end.dateTime).toISOString(),
      htmlLink: event.htmlLink,
      calendar: { id: env.GOOGLE_CALENDAR_ID, timeZone: env.CONSULTANT_TIME_ZONE }
    }, 201);
  } catch (error) {
    console.error('Booking failed:', error.message);
    return jsonResponse({ error: 'Google Calendar could not complete the booking.' }, 502);
  }
}

