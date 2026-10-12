import { Href, useRouter } from 'expo-router';

/**
 * Navigation hook providing a react-router style navigate function
 * backed by Expo Router's useRouter.
 */
export function useNavigate() {
  const router = useRouter();

  return (to: string | Href | number) => {
    if (typeof to === 'number') {
      if (to === -1) {
        router.back();
      }
      return;
    }
    router.push(to as Href);
  };
}
