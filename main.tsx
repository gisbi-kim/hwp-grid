// 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from './app/page';
import './app/globals.css';
import './lib/font-imports';
createRoot(document.getElementById('root')!).render(<Home/>);
