// Navigation never owns the cart: both ways of starting share the same meal.
export function createJourney() {
  let mode = null, view = 'home';
  return {
    get mode() { return mode; },
    get view() { return view; },
    choose(next) {
      if (!['wishes', 'menu'].includes(next)) return false;
      mode = next; view = next; return true;
    },
    go(next) {
      if (!['home', 'wishes', 'menu', 'table'].includes(next) || (next !== 'home' && !mode)) return false;
      if (next === 'wishes') mode = 'wishes';
      view = next; return true;
    },
  };
}

export function mealAction({ view, hasItems, pending, valid }) {
  if (!hasItems || !['menu', 'table'].includes(view)) return null;
  if (view === 'menu') return { action: 'table', label: '选好了，分给大家', disabled: false };
  if (pending) return { action: 'quote', label: '正在更新价格…', disabled: true };
  if (!valid) return { action: 'quote', label: '重新核价', disabled: false };
  return { action: 'share', label: '查看并分享餐单', disabled: false };
}
