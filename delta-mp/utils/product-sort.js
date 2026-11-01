export const productSortOptions = [
  { label: '综合排序', value: 'default' },
  { label: '销量排序', value: 'sales' },
  { label: '最新发布', value: 'newest' },
  { label: '价格由低到高', value: 'price_asc' },
  { label: '价格由高到低', value: 'price_desc' }
]

export function productSortParams(value) {
  if (value === 'price_asc') return { orderBy: 'price', orderDir: 'asc' }
  if (value === 'price_desc') return { orderBy: 'price', orderDir: 'desc' }
  return { orderBy: value === 'sales' || value === 'newest' ? value : 'sort', orderDir: 'desc' }
}
