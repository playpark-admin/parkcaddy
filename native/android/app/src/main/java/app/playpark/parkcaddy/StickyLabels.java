package app.playpark.parkcaddy;
import java.util.*;

/** Preserve visible physical cells before filling vacancies from distance bands. */
final class StickyLabels {
 private final List<String> previous=new ArrayList<>();
 void clear(){previous.clear();}
 int[] select(String[] keys,float[] x,float[] y,int[] candidates,float dx,float dy){
  List<Integer> selected=new ArrayList<>();
  for(String key:previous)for(int i=0;i<keys.length;i++)if(key.equals(keys[i])){add(selected,i,x,y,dx,dy);break;}
  for(int i:candidates)add(selected,i,x,y,dx,dy);
  if(keys.length>0){previous.clear();for(int i:selected)previous.add(keys[i]);}
  int[] result=new int[selected.size()];for(int i=0;i<result.length;i++)result[i]=selected.get(i);return result;
 }
 private static void add(List<Integer> selected,int i,float[] x,float[] y,float dx,float dy){
  if(selected.size()>=5||selected.contains(i))return;
  for(int j:selected)if(Math.abs(x[i]-x[j])<dx&&Math.abs(y[i]-y[j])<dy)return;
  selected.add(i);
 }
}
